// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFPair {
    function getReserves() external view returns (uint256, uint256);

    function assetBalance() external view returns (uint256);

    function syntheticAssetBalance() external view returns (uint256);

    function balance() external view returns (uint256);

    function mint() external returns (bool);

    function burnToken(uint256 amount) external returns (bool);

    function transferAsset(address recipient, uint256 amount) external;

    function transferTo(address recipient, uint256 amount) external;

    function tokenA() external view returns (address);
    
    function tokenB() external view returns (address);

    function swap(
        uint256 amount0In,
        uint256 amount0Out,
        uint256 amount1In,
        uint256 amount1Out
    ) external returns (bool);

    function approval(
        address _user,
        address _token,
        uint256 amount
    ) external returns (bool);

    function getAmountOut(
        address inputToken,
        uint256 amountIn
    ) external view returns (uint256 amountOut);
}