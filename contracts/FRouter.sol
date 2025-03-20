// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./FFactory.sol";
import "./IFPair.sol";
// import "../tax/IBondingTax.sol";

contract FRouter is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    FFactory public factory;
    address public assetToken;
    address public taxManager;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address factory_,
        address assetToken_
    ) external initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        require(factory_ != address(0), "Zero addresses are not allowed.");
        require(assetToken_ != address(0), "Zero addresses are not allowed.");

        factory = FFactory(factory_);
        assetToken = assetToken_;
    }

    // Calculates the expected output when swapping assetToken for token
    // To calculate the expected output when swapping token for assetToken, pass address(0) as assetToken_
    function getAmountsOut(
        address inputToken,
        address outputToken,
        uint256 amountIn
    ) public view returns (uint256 amountOut) {
        require(inputToken != address(0) && outputToken != address(0), "Zero addresses are not allowed.");
        require(inputToken != outputToken, "Tokens must be different.");

        address pairAddress = factory.getPair(inputToken, outputToken);
        IFPair pair = IFPair(pairAddress);

        (uint256 reserveA, uint256 reserveB) = pair.getReserves();
        uint256 k = pair.kLast();

        if (inputToken == assetToken) {
            // Selling assetToken to get another token
            uint256 newReserveA = reserveA + amountIn;
            uint256 newReserveB = k / newReserveA;
            amountOut = reserveB - newReserveB;
        } else {
            // Selling a token to get assetToken
            uint256 newReserveB = reserveB + amountIn;
            uint256 newReserveA = k / newReserveB;
            amountOut = reserveA - newReserveA;
        }

        return amountOut;
    }


    function addInitialLiquidity(
        address token_,
        uint256 amountToken_,
        uint256 amountAsset_
    ) public onlyRole(EXECUTOR_ROLE) returns (uint256, uint256) {
        require(token_ != address(0), "Zero addresses are not allowed.");

        address pairAddress = factory.getPair(token_, assetToken);

        IFPair pair = IFPair(pairAddress);

        IERC20 token = IERC20(token_);

        token.safeTransferFrom(msg.sender, pairAddress, amountToken_);

        pair.mint(amountToken_, amountAsset_);

        return (amountToken_, amountAsset_);
    }

    function sell(
        uint256 amountIn,
        address tokenAddress,
        address to
    ) public nonReentrant onlyRole(EXECUTOR_ROLE) returns (uint256, uint256) {
        require(tokenAddress != address(0), "Zero addresses are not allowed.");
        require(to != address(0), "Zero addresses are not allowed.");

        address pairAddress = factory.getPair(tokenAddress, assetToken);

        IFPair pair = IFPair(pairAddress);

        IERC20 token = IERC20(tokenAddress);

        uint256 amountOut = getAmountsOut(tokenAddress, assetToken, amountIn);

        token.safeTransferFrom(to, pairAddress, amountIn);

        uint fee = factory.sellTax();
        uint256 txFee = (fee * amountOut) / 100;

        uint256 amount = amountOut - txFee;
        address feeTo = factory.taxVault();

        pair.approval(address(this), assetToken, amountOut);
        pair.transferAsset(to, amount);
        pair.transferAsset(feeTo, txFee);

        pair.swap(amountIn, 0, 0, amountOut);

        // if (feeTo == taxManager) {
        //     IBondingTax(taxManager).swapForAsset();
        // }

        return (amountIn, amountOut);
    }

    function buy(
        uint256 amountIn,
        address tokenAddress,
        address to
    ) public onlyRole(EXECUTOR_ROLE) nonReentrant returns (uint256, uint256) {
        require(tokenAddress != address(0), "Zero addresses are not allowed.");
        require(to != address(0), "Zero addresses are not allowed.");
        require(amountIn > 0, "amountIn must be greater than 0");

        address pair = factory.getPair(tokenAddress, assetToken);

        uint fee = factory.buyTax();
        uint256 txFee = (fee * amountIn) / 100;
        address feeTo = factory.taxVault();

        uint256 amount = amountIn - txFee;
        
        IERC20(assetToken).safeTransferFrom(to, pair, amount);

        IERC20(assetToken).safeTransferFrom(to, feeTo, txFee);

        uint256 amountOut = getAmountsOut(tokenAddress, assetToken, amount);

        IFPair(pair).transferTo(to, amountOut);

        IFPair(pair).swap(0, amountOut, amount, 0);

        // if (feeTo == taxManager) {
        //     IBondingTax(taxManager).swapForAsset();
        // }

        return (amount, amountOut);
    }

    function graduate(
        address tokenAddress
    ) public onlyRole(EXECUTOR_ROLE) nonReentrant {
        require(tokenAddress != address(0), "Zero addresses are not allowed.");
        address pair = factory.getPair(tokenAddress, assetToken);
        uint256 assetBalance = IFPair(pair).assetBalance();
        FPair(pair).transferAsset(msg.sender, assetBalance);
    }

    function approval(
        address pair,
        address asset,
        address spender,
        uint256 amount
    ) public onlyRole(EXECUTOR_ROLE) nonReentrant {
        require(spender != address(0), "Zero addresses are not allowed.");

        IFPair(pair).approval(spender, asset, amount);
    }

    function setTaxManager(address newManager) public onlyRole(ADMIN_ROLE) {
        taxManager = newManager;
    }
}
