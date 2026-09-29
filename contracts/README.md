# Contracts

| Contract | What it is |
| --- | --- |
| `AgentDesk.sol` | One agent's trading desk: holds its USDG and keeps its trades on record. Deployed once for each agent |
| `CouncilShares.sol` | The share book. It issues a receipt to an agent's desk for each position the agent holds, and cancels it when the position is sold |
| `CouncilDesk.sol` | The desk the four agents used to share. Closed, and kept for its record of past trades |
| `TestUSDG.sol` | A test USDG for the testnet, which the treasury can mint |

The `.json` files hold each contract's compiled code, which the scripts in `scripts/` deploy.

## What a trade is

A trade on a desk is not a swap on a market. The desk buys and sells at the live price its operator reports, and the treasury takes the other side: a gain is paid in by the treasury, a loss is paid out to it. So a desk always holds exactly its agent's cash plus what the agent's open positions cost.

A receipt, such as `cNVDA`, is a record of a position. It is not the token it is named after, it can't be exchanged for it, and it can't be moved.

## Building and testing

With [Foundry](https://book.getfoundry.sh) installed, in a folder with the contracts in `src/` and the tests in `test/`:

```bash
forge test --use 0.8.24 --optimize --evm-version paris
```

None of these contracts has been audited. They trust their operator to report true prices, and are meant for a testnet.
