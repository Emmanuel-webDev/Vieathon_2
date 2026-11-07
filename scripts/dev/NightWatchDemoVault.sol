// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract NightWatchDemoVault {
    address public owner;
    mapping(address => uint256) public balances;

    event Deposit(address indexed sender, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    // Flaw 1: Classical reentrancy vulnerability
    function withdrawAll() external {
        uint256 bal = balances[msg.sender];
        require(bal > 0, "No balance");
        (bool ok, ) = msg.sender.call{value: bal}("");
        require(ok, "Transfer failed");
        balances[msg.sender] = 0;
        emit Withdraw(msg.sender, bal);
    }

    // Flaw 2: Unprotected owner overwrite
    function setOwner(address newOwner) external {
        owner = newOwner;
        emit OwnerChanged(msg.sender, newOwner);
    }

    // Flaw 3: tx.origin authorization
    function emergencySweep(address payable to) external {
        require(tx.origin == owner, "Not owner");
        to.transfer(address(this).balance);
    }

    receive() external payable {}
}
