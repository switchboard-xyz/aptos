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
  "0x86252100b1050c2e97178ac9c01216a4d70f99d1dbccad1224280b3f378697d3"
);

// Fetch and log the oracle responses
const { updates } = await aggregator.fetchUpdate();


// Create a transaction to run the feed update
const updateTx = await client.aptos.transaction.build.simple({
  sender: signer,
  data: {
    function: `0xcd4f9302fa687337d1e7a25f5b378aff941ceda8f2a8f76e2cef62c2d13bfdb3::example_basic_read::update_and_read_feed`,
    functionArguments: [updates, aggregator.address],
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
