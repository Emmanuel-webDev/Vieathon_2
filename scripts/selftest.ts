import { runSolidityRules } from "../lib/rules";
import { scanOpcodes } from "../lib/onchain";
import { hashReport } from "../lib/hash";
import { parseTarget } from "../lib/target";

const vuln = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IERC20 { function transfer(address,uint) external returns (bool); function transferFrom(address,address,uint) external returns (bool); }
contract Vault {
  mapping(address => uint) public bal;
  address public owner;
  IERC20 public token;
  function initialize(address o) external { owner = o; }
  function deposit(uint a) external { token.transferFrom(msg.sender, address(this), a); bal[msg.sender] += a; }
  function pull(address from, uint a) external { token.transferFrom(from, address(this), a); }
  function withdraw() external {
    uint b = bal[msg.sender];
    (bool ok, ) = msg.sender.call{value: b}("");
    bal[msg.sender] = 0;
  }
  function auth() external view returns (bool) { return tx.origin == owner; }
  function mint(address to, uint a) external { bal[to] += a; }
  // tx.origin in a comment must not trigger
}`;
const safe = `pragma solidity 0.8.26;
contract Safe { uint x; function set(uint v) external { x = v; } }`;
const f = runSolidityRules([{ path: "src/Vault.sol", content: vuln }, { path: "src/Safe.sol", content: safe }]);
for (const x of f) console.log(`${x.severity.padEnd(8)} ${x.file}:${x.line}  ${x.title}`);
console.log("safe file findings:", f.filter(x => x.file === "src/Safe.sol").length);
// opcode scan: PUSH1 0xff must NOT count; bare 0xff must
console.log("opcode push-data ff:", JSON.stringify(scanOpcodes("0x60ff00")), " bare ff:", JSON.stringify(scanOpcodes("0x00ff")), " delegatecall:", JSON.stringify(scanOpcodes("0xf4")));
// hash stability regardless of key order
const a: any = { version: 1, b: 1, a: [1, { y: 2, x: 3 }] }, b: any = { a: [1, { x: 3, y: 2 }], b: 1, version: 1 };
console.log("hash stable:", hashReport(a) === hashReport(b));
for (const t of ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "https://github.com/foundry-rs/forge-std/tree/master/src", "https://basescan.org/address/0x4200000000000000000000000000000000000006", "your-dapp.xyz"]) console.log(parseTarget(t).kind);
try { parseTarget("not a thing !!"); } catch (e: any) { console.log("bad input ->", e.message); }
