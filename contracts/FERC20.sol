// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FERC20 is ERC20, ERC20Burnable, Ownable {
    uint256 public maxTx; // The maximum percentage of the token that can be bought at once
    uint256 private _maxTxAmount; // The maximum amount of token that can be bought at once, derived from maxTx
    mapping(address => bool) private isExcludedFromMaxTx;
    mapping(address => bool) public isIncludedInTax;

    address public taxReceiver;
    uint256 public taxBasisPoints; // 100 = 1%, 1000 = 10%, etc.

    event MaxTxUpdated(uint256 _maxTx);
    event TaxSettingsUpdated(address receiver, uint256 bps);
    
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

    function setIsIncludedInTax(address addr) public onlyOwner {
        isIncludedInTax[addr] = true;
    }

    function updateTaxSettings(
        address _receiver,
        uint256 _taxBps
    ) external onlyOwner {
        require(_receiver != address(0), "ERC20: zero tax address");
        require(_taxBps <= 1000, "ERC20: tax too high"); // max 10%
        taxReceiver = _receiver;
        taxBasisPoints = _taxBps;
        emit TaxSettingsUpdated(_receiver, _taxBps);
    }

    function transfer(address recipient, uint256 amount) public override returns (bool) {
        _checkMaxTx(_msgSender(), amount);
        _transferWithTax(_msgSender(), recipient, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) public override returns (bool) {
        _checkMaxTx(sender, amount);
        address spender = _msgSender();
        _spendAllowance(sender, spender, amount);
        _transferWithTax(sender, recipient, amount);
        return true;
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

    function _transferWithTax(address from, address to, uint256 amount) internal {
        if (
            taxBasisPoints > 0 &&
            (isIncludedInTax[from] || isIncludedInTax[to]) &&
            from != taxReceiver &&
            to != taxReceiver
        ) {
            uint256 tax = (amount * taxBasisPoints) / 10_000;
            uint256 remaining = amount - tax;
            super._transfer(from, taxReceiver, tax);
            super._transfer(from, to, remaining);
        } else {
            super._transfer(from, to, amount);
        }
    }
}
