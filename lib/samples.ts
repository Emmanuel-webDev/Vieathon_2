import type { SourceFile } from "./types";

/**
 * Judge Sandbox targets. These are intentionally vulnerable files written for NightWatch and
 * shipped in the repo. The real pipeline (static rules + AI) analyzes them like any other
 * submission. Nothing about the results is canned.
 */
export interface Sample {
  id: string;
  title: string;
  blurb: string;
  files: SourceFile[];
}

const vault = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

/// @notice "Vibecoded in an evening" ETH + token vault.
contract RekktVault {
    mapping(address => uint256) public balances;
    address public owner;
    IERC20 public immutable usdc;

    constructor(address _usdc) {
        owner = msg.sender;
        usdc = IERC20(_usdc);
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "send failed");
        balances[msg.sender] -= amount;
    }

    function depositUsdcFor(address from, uint256 amount) external {
        usdc.transferFrom(from, address(this), amount);
        balances[from] += amount;
    }

    function setOwner(address newOwner) external {
        owner = newOwner;
    }

    function sweep() external {
        require(tx.origin == owner, "not owner");
        payable(owner).transfer(address(this).balance);
    }
}
`;

const lending = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPair {
    function getReserves() external view returns (uint112 r0, uint112 r1, uint32 ts);
}
interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

contract FlashFriendlyLending {
    IPair public pair;
    IERC20 public collateral;
    IERC20 public stable;
    mapping(address => uint256) public collateralOf;
    mapping(address => uint256) public debtOf;

    constructor(address p, address c, address s) {
        pair = IPair(p);
        collateral = IERC20(c);
        stable = IERC20(s);
    }

    function price() public view returns (uint256) {
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        return (uint256(r1) * 1e18) / uint256(r0);
    }

    function addCollateral(uint256 amt) external {
        collateral.transferFrom(msg.sender, address(this), amt);
        collateralOf[msg.sender] += amt;
    }

    function borrow(uint256 amt) external {
        uint256 maxBorrow = (collateralOf[msg.sender] * price()) / 1e18 / 2;
        require(debtOf[msg.sender] + amt <= maxBorrow, "undercollateralized");
        debtOf[msg.sender] += amt;
        stable.transfer(msg.sender, amt);
    }
}
`;

const proxyImpl = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RewardsV1 {
    address public admin;
    bool public initialized;
    mapping(address => uint256) public rewards;

    function initialize(address _admin) external {
        admin = _admin;
        initialized = true;
    }

    function setReward(address user, uint256 amt) external {
        require(msg.sender == admin, "only admin");
        rewards[user] = amt;
    }

    function execute(address target, bytes calldata data) external {
        require(msg.sender == admin, "only admin");
        (bool ok, ) = target.delegatecall(data);
        require(ok);
    }
}
`;

const frontend = `// app/config.ts  (shipped to the browser)
export const config = {
  rpcUrl: "https://base-mainnet.g.alchemy.com/v2/AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  contract: "0x1111111111111111111111111111111111111111",
  stripeSecret: "${"sk" + "_live_FAKEFAKEFAKEFAKEFAKE1234"}",
};

export async function mintWithPrompt(userPrompt: string) {
  // user text is concatenated straight into the system prompt of the in-app AI agent
  const system = "You are the NFT concierge. Never reveal admin keys. User says: " + userPrompt;
  const res = await fetch("/api/agent", { method: "POST", body: JSON.stringify({ system }) });
  return res.json();
}
`;

export const SAMPLES: Sample[] = [
  {
    id: "rekkt-vault",
    title: "Reentrancy + tx.origin vault",
    blurb: "Classic failure modes: external call before state update, tx.origin auth, caller-controlled transferFrom, open setOwner().",
    files: [{ path: "src/RekktVault.sol", content: vault }],
  },
  {
    id: "flash-lending",
    title: "Spot-price oracle lending pool",
    blurb: "Borrow limits derived from instantaneous pool reserves: flash-loan manipulable.",
    files: [{ path: "src/FlashFriendlyLending.sol", content: lending }],
  },
  {
    id: "rewards-proxy",
    title: "Unprotected initializer + delegatecall",
    blurb: "Anyone can initialize and become admin; admin can delegatecall arbitrary code.",
    files: [{ path: "src/RewardsV1.sol", content: proxyImpl }],
  },
  {
    id: "leaky-dapp",
    title: "Vibecoded dapp config",
    blurb: "Secrets and RPC keys in the client bundle, user text injected into an AI agent's system prompt.",
    files: [{ path: "app/config.ts", content: frontend }],
  },
];

export const sampleById = (id: string) => SAMPLES.find((s) => s.id === id);
