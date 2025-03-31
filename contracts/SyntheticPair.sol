// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IFPair.sol";
import "./FERC20.sol";

contract SyntheticPair is IFPair, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public router;
    address public tokenA;
    address public tokenB;
    
    // This is the multiplier on the assetToken - it is an arbitrary constant that's used to influence the total percentage of token x assetToken can buy.
    uint multiplier; 

    uint256 private lastUpdated;

    constructor(address router_, address token0, address token1, uint multiplier_) {
        require(router_ != address(0), "Zero addresses are not allowed.");
        require(token0 != address(0), "Zero addresses are not allowed.");
        require(token1 != address(0), "Zero addresses are not allowed.");

        router = router_;
        tokenA = token0;
        tokenB = token1;
        multiplier = multiplier_;
    }

    modifier onlyRouter() {
        require(router == msg.sender, "Only router can call this function");
        _;
    }

    event Mint(uint256 reserve0, uint256 reserve1);

    event Swap(
        uint256 amount0In,
        uint256 amount0Out,
        uint256 amount1In,
        uint256 amount1Out
    );

    // Mint here assumes the assets have been transferred to itself by the router.
    // It doesn't do anything except emit the Mint event
    function mint() public onlyRouter returns (bool) {
        require(lastUpdated == 0, "Already minted");

        uint256 balance0 = IERC20(tokenA).balanceOf(address(this));
        uint256 balance1 = IERC20(tokenB).balanceOf(address(this));

        lastUpdated = block.timestamp;

        emit Mint(balance0, balance1);
        return true;
    }


    // Swap also doesn't perform any swap, it just emits an event.
    // It relies on the router calling it to have transferred the funds to it and provide the correct values for the event emitted.
    function swap(
        uint256 amount0In,
        uint256 amount0Out,
        uint256 amount1In,
        uint256 amount1Out
    ) public onlyRouter returns (bool) {
        lastUpdated = block.timestamp;

        emit Swap(amount0In, amount0Out, amount1In, amount1Out);
        return true;
    }

    function approval(
        address _user,
        address _token,
        uint256 amount
    ) public onlyRouter returns (bool) {
        require(_user != address(0), "Zero addresses are not allowed.");
        require(_token != address(0), "Zero addresses are not allowed.");

        IERC20 token = IERC20(_token);

        token.forceApprove(_user, amount);

        return true;
    }

    function transferAsset(
        address recipient,
        uint256 amount
    ) public onlyRouter {
        require(recipient != address(0), "Zero addresses are not allowed.");

        IERC20(tokenB).safeTransfer(recipient, amount);
    }

    function transferTo(address recipient, uint256 amount) public onlyRouter {
        require(recipient != address(0), "Zero addresses are not allowed.");

        IERC20(tokenA).safeTransfer(recipient, amount);
    }

    function getReserves() public view returns (uint256, uint256) {
        uint256 balance0 = IERC20(tokenA).balanceOf(address(this));
        uint256 balance1 = IERC20(tokenB).balanceOf(address(this));
        return (balance0, balance1);
    }

    function balance() public view returns (uint256) {
        return IERC20(tokenA).balanceOf(address(this));
    }

    function assetBalance() public view returns (uint256) {
        return IERC20(tokenB).balanceOf(address(this));
    }

    // This returns the synthetic asset balance in the pool.
    function syntheticAssetBalance() public view returns (uint256) {
        return multiplier * assetBalance();
    }

    function burnToken(uint256 amount) public onlyRouter returns (bool) {
        FERC20(tokenA).burn(amount);
        return true;
    }

    function getAmountOut(address inputToken, uint256 amountIn) external view returns (uint256 amountOut) {
        require(amountIn > 0, "Amount in must be greater than zero");

        uint256 balance0 = balance();
        uint256 balance1 = syntheticAssetBalance();

        uint256 reserveIn;
        uint256 reserveOut;

        if (inputToken == tokenA) {
            reserveIn = balance0;
            reserveOut = balance1;
        } else if (inputToken == tokenB) {
            reserveIn = balance1;
            reserveOut = balance0;
        } else {
            revert("Invalid input token");
        }

        amountOut = (amountIn * reserveOut) / (reserveIn + amountIn);
    }
}
