// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FERC20 is ERC20, ERC20Burnable, Ownable {
    uint256 public maxTx; // The maximum percentage of the token that can be bought at once
    uint256 private _maxTxAmount; // The maximum amount of token that can be bought at once, derived from maxTx
    mapping(address => bool) private isExcludedFromMaxTx;

    event MaxTxUpdated(uint256 _maxTx);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply,
        uint256 _maxTx
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _mint(msg.sender, supply);
        isExcludedFromMaxTx[msg.sender] = true;
        isExcludedFromMaxTx[address(this)] = true;
        _updateMaxTx(_maxTx);
    }

    function _updateMaxTx(uint256 _maxTx) internal {
        maxTx = _maxTx;
        _maxTxAmount = (maxTx * totalSupply()) / 100;
        emit MaxTxUpdated(_maxTx);
    }

    function updateMaxTx(uint256 _maxTx) public onlyOwner {
        _updateMaxTx(_maxTx);
    }

    function excludeFromMaxTx(address user) public onlyOwner {
        require(user != address(0), "ERC20: Exclude Max Tx from zero address");
        isExcludedFromMaxTx[user] = true;
    }

    function transfer(address recipient, uint256 amount) public override returns (bool) {
        _checkMaxTx(_msgSender(), amount);
        return super.transfer(recipient, amount);
    }

    function transferFrom(address sender, address recipient, uint256 amount) public override returns (bool) {
        _checkMaxTx(sender, amount);
        return super.transferFrom(sender, recipient, amount);
    }

    function forceApprove(address spender, uint256 amount) public returns (bool) {
        _approve(_msgSender(), spender, 0);
        _approve(_msgSender(), spender, amount);
        return true;
    }

    function _checkMaxTx(address sender, uint256 amount) internal view {
        if (!isExcludedFromMaxTx[sender]) {
            require(amount <= _maxTxAmount, "Exceeds MaxTx");
        }
    }
}
