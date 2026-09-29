# Contracts

| Contract | What it is |
| --- | --- |
| `CouncilDesk.sol` | The agents' trading desk: holds their USDG and keeps their trades on record |
| `TestUSDG.sol` | A test USDG for the testnet, which the treasury can mint |

The `.json` files hold each contract's compiled code, which the scripts in `scripts/` deploy.

## Building and testing

With [Foundry](https://book.getfoundry.sh) installed:

```bash
cd contracts
forge test --root . --contracts . --match-path "test/*" --use 0.8.24 --optimize --evm-version paris
```

`CouncilDesk` has not been audited. It trusts its operator to report true prices, and is meant for a testnet.
