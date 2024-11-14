import {
  Aggregator,
  Queue,
  Oracle,
  SwitchboardClient,
  axiosAptosClient,
  waitForTx,
  OracleData,
} from "@switchboard-xyz/aptos-sdk";
import {
  Account,
  Aptos,
  AptosConfig,
  Network,
  Ed25519PrivateKey,
  Ed25519Account,
  PrivateKey,
  PrivateKeyVariants,
  APTOS_COIN,
} from "@aptos-labs/ts-sdk";
import * as fs from "fs";
import * as YAML from "yaml";

// ==============================================================================
// Setup Signer and account
// ==============================================================================
const parsedYaml = YAML.parse(fs.readFileSync("./.aptos/config.yaml", "utf8"));
const privateKey = PrivateKey.formatPrivateKey(
  parsedYaml!.profiles!.default!.private_key!,
  PrivateKeyVariants.Ed25519
);
const pk = new Ed25519PrivateKey(privateKey);
const signer = parsedYaml!.profiles!.default!.account!;

const account = new Ed25519Account({
  privateKey: pk,
  address: signer,
});

// ==============================================================================
// Setup Aptos RPC
// ==============================================================================

const config = new AptosConfig({
  network: Network.TESTNET,
  client: { provider: axiosAptosClient },
});
const aptos = new Aptos(config);

const client = new SwitchboardClient(aptos);
const { switchboardAddress } = await client.fetchState();

console.log("Switchboard address:", switchboardAddress);

const aggregator = new Aggregator(
  client,
  "0x4bac6bbbecfe7be5298358deaf1bf2da99c697fea16a3cf9b0e340cb557b05a8"
);

// Fetch and log the oracle responses
const { updates } = await aggregator.fetchUpdate(signer);

// Create a transaction to run the feed update
const updateTx = await client.aptos.transaction.build.simple({
  sender: signer,
  data: {
    function: `0x49c02736ed2eb65bb428c5e233e4ae51b11d11af8aa520bda223e2f9609326fd::example_basic_read::update_and_read_feed`,
    functionArguments: [updates],
  },
});

const res = await aptos.signAndSubmitTransaction({
  signer: account,
  transaction: updateTx,
});

const result = await aptos.waitForTransaction({
  transactionHash: res.hash,
  options: {
    timeoutSecs: 30,
    checkSuccess: true,
  },
});

// Log the transaction results
console.log(result);
