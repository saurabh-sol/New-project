# 7. Contracts

[Back to the index](README.md)

Every agent has a contract of its own on Robinhood Chain, so that what an agent did can be read at one address. The contracts are optional: without them the desk works the same, and its trades are kept in the database only.

## What a trade on a contract is

**A trade on a desk contract is not a swap on a market.** The contract buys and sells at the live price its operator reports, and the treasury takes the other side: a gain is paid in by the treasury, a loss is paid out to it. So a contract always holds exactly its agent's cash plus what the agent's open positions cost.

The contracts have not been audited. They trust their operator to report true prices. They are meant for the testnet.

## The contracts

| Contract | What it is |
| --- | --- |
| `contracts/AgentDesk.sol` | One agent's desk: holds its USDG and keeps its trades on record. Deployed once for each agent |
| `contracts/CouncilShares.sol` | The share book. It issues a receipt to an agent's desk for each position the agent holds, and cancels it when the position is sold |
| `contracts/TestUSDG.sol` | A test USDG for the testnet, which the treasury can mint |
| `contracts/CouncilDesk.sol` | The desk the four agents used to share. Closed, and kept for its record of past trades |

The `.json` files beside them hold each contract's compiled code, which the scripts deploy. They are compiled with Solidity 0.8.24, the optimizer at 200 runs, for the `paris` EVM.

## What an agent's desk does

| What it does | How |
| --- | --- |
| Gives the agent an address of its own | What an agent did can be read at its address, on the block explorer. The contract carries the agent's name |
| Holds the agent's USDG | The agent's cash, and what its open positions cost, are in its own contract |
| Records the agent's trades | An agent's part of a purchase or sale is a transaction on its own contract. A trade three agents made together is three transactions |
| Shows what the agent holds | For each position the contract holds a receipt, such as `cROO`, issued by the share book. It appears among the contract's tokens on the explorer |
| Settles gains and losses in USDG | When a position closes at a gain, the treasury pays the gain in. At a loss, the contract pays the treasury |
| Stays fully backed | `solvent()` is true while the contract holds at least what it owes its agent |
| Refuses everyone but the desk | Only the operator, which is the treasury, can fund an agent and record its trades |

A **receipt** is a record, and no more than that. It is not the token it is named after, it can't be exchanged for that token, and it can't be moved from the contract it was issued to.

### What can be called

| Function | Who | What it does |
| --- | --- | --- |
| `fund(amount)` | operator | Puts USDG from the treasury behind the agent |
| `release(amount)` | operator | Returns USDG from the agent's free cash to the treasury |
| `buy(trade)` | operator | Records a purchase, takes its cost from the agent's cash, and has a receipt issued |
| `sell(trade)` | operator | Records a sale, settles the gain or loss with the treasury, and has the receipt cancelled |
| `agent()`, `cash()`, `capital()` | anyone | The agent's name, its free cash, and what was put into it |
| `position(token)`, `holdings()` | anyone | What the agent holds in a token, and the tokens it holds |
| `result()`, `gained()`, `lost()` | anyone | The agent's realised result |
| `owed()`, `solvent()` | anyone | What the contract must hold, and whether it does |
| `recorded(id)` | anyone | Whether a trade is on record |
| `setOperator`, `setTreasury`, `setOwner` | owner | Hands the contract to another operator, treasury or owner |
| `sweep()` | owner | Sends the treasury whatever USDG the contract holds beyond what it owes |

A trade carries an id, the session, the token's address and symbol, the price, the quantity, the amount in USDG, and the reason. A contract refuses a trade whose id it already holds, and one whose amount is more than two cents from the price times the quantity.

## The order of things

The database is where the books are kept. The chain follows.

1. A trade, deposit or withdrawal changes the books in the database.
2. The server then makes the same change on-chain, on the contract of each agent it concerns (`src/server/chains/desk.ts`).
3. Each transaction's hash is saved with the trade, and the order history links to them.

If the chain can't be reached, step 2 waits and is tried again, four times at most. A contract can lag the books by a moment. It never holds up a session or a payment. A trade is recorded once, whoever tries, and a trade that broke off after two of its three agents is taken up at the third.

## Where the contracts are

| | Robinhood Chain testnet, which the site runs on | Robinhood Chain mainnet |
| --- | --- | --- |
| The Researcher's desk | `0x38b8f564aa603707580e091fa6f5b89ad11b6bc8` | `0xf543786e6f5793904245414aebc427c7ec090387` |
| The Observer's desk | `0x17c17353f7e2424a8560772b93c3d943c36f001e` | `0xf8a28d9ea736a2dfd4e425b17cfde845859b1675` |
| The Strategist's desk | `0x7fb674e69a48a8320b42c5d9c2ea0bb486f70bcb` | `0x5e9afd96d88d98b8efca96b57a5816854b1f61d9` |
| The Executor's desk | `0xf26d49310d513266f03967ace14b305154947348` | `0xc25d7c5980819a4da5286e75d9cd7393012862ae` |
| The share book | `0xf8f674caa3fed59528cf38ac7b294a8959ffdce9` | `0x57e2fd4848709acc6f43935cff028d0a4bc50102` |
| Treasury, which owns and operates them | `0xf7D07942E1F8633F54F9200CB3b54d05EE60dca2` | `0x883b885C8F70b733B1C134FF621B033697bAf1DF` |
| Funding token | test USDG `0xd656dd44e8f0270174a204d70b62a450950b1188` | USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Explorer | [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com) | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |

Their source is published on both explorers, and on [Sourcify](https://sourcify.dev) for mainnet, where it matches the deployed code exactly.

**The mainnet contracts are deployed and hold nothing.** The site does not use them. They were deployed with `--no-approve`, so they cannot draw USDG from the treasury. [Deployment](12-deployment.md#moving-to-mainnet) says what pointing the site at them would take.

## Deploying

```bash
node --env-file=.env.local scripts/deploy-desks.mjs
```

| What the script does | |
| --- | --- |
| Deploys | The share book, then a desk for each agent, with the agent's name |
| Registers | Each desk with the share book |
| Approves | Lets each desk draw USDG from the treasury. `--no-approve` leaves this out |
| Writes | `DESK_QUANT`, `DESK_DEGEN`, `DESK_GUARDIAN`, `DESK_ORACLE`, `DESK_SHARES`, `DESK_FROM_BLOCK` to the env file |

It can be run again if it broke off: what is already written to the file is not deployed twice. It refuses mainnet unless `ALLOW_MAINNET_FUNDING=true`.

The server puts each agent's cash, and the positions it already holds, into its contract the first time it runs with them.

## Replacing the contracts

Do it in this order. The old contracts must be closed last, because until the server runs with the new ones it would put the money back into the old.

1. Remove the four `DESK_<AGENT>` lines from the env file. Keep `DESK_SHARES` to reuse the share book.
2. Run `scripts/deploy-desks.mjs`.
3. Set the six settings on the host and deploy.
4. Wait until every agent's contract holds what the books say it should.
5. Close the old ones:

   ```bash
   node --env-file=.env.local scripts/retire-desks.mjs 0x<old desk> 0x<old desk> ...
   ```

Closing sells every position on the old contract at what it cost, so no gain or loss is settled, releases the agent's cash to the treasury, and strikes the contract off the share book. The books are not touched.

## Verifying the source

| Network | How |
| --- | --- |
| Testnet | The explorer's API accepts the source as standard JSON input |
| Mainnet | Sourcify's API accepts it, and Blockscout picks it up when the contract's page is opened. The mainnet explorer's own API refuses scripts |

## Testing

With [Foundry](https://book.getfoundry.sh) installed, in a folder with the contracts in `src/` and the tests in `test/`:

```bash
forge test --use 0.8.24 --optimize --evm-version paris
```

`contracts/test/AgentDesk.t.sol` holds 18 tests of an agent's desk. The tests of the old shared desk are beside it.
