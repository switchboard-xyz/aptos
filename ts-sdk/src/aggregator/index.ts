import type { CommonOptions, SwitchboardClient } from "../index.js";
import {
  aptosQueueCache,
  hexToB58,
  Queue,
  solanaProgramCache,
} from "../index.js";

import type { SimpleTransaction } from "@aptos-labs/ts-sdk";
import { AccountAddress, APTOS_COIN } from "@aptos-labs/ts-sdk";
import { bs58, CrossbarClient, OracleJob } from "@switchboard-xyz/common";
import type {
  FeedEvalResponse,
  Queue as SolanaQueue,
} from "@switchboard-xyz/on-demand";
import {
  getDefaultDevnetQueue,
  getDefaultQueue,
  ON_DEMAND_DEVNET_QUEUE,
  ON_DEMAND_MAINNET_QUEUE,
} from "@switchboard-xyz/on-demand";
import BN from "bn.js";

interface WithFeePayer {
  /// Optional address that will pay for the transaction fees instead of the sender
  feePayer?: string;
}

export interface AggregatorInitParams extends CommonOptions, WithFeePayer {
  name: string;
  feedHash: string;
  minSampleSize: number;
  maxStalenessSeconds: number;
  maxVariance: number;
  minResponses: number;
}

export interface AggregatorConfigParams extends CommonOptions, WithFeePayer {
  aggregator: string;
  name: string;
  feedHash: string;
  minSampleSize: number;
  maxStalenessSeconds: number;
  maxVariance: number;
  minResponses: number;
}

export interface AggregatorSetAuthorityParams
  extends CommonOptions,
    WithFeePayer {
  aggregator: string;
  newAuthority: string;
}

export interface AggregatorConfigs {
  feedHash: string;
  maxVariance: number;
  minResponses: number;
  minSampleSize: number;
}

export interface AggregatorFetchUpdateIxParams
  extends CommonOptions,
    WithFeePayer {
  /// If passed in, update will be condensed into a single tx returned
  sender?: string;
  gateway?: string;
  solanaRPCUrl?: string;
  crossbarUrl?: string;
  crossbarClient?: CrossbarClient;
  jobs?: OracleJob[];

  // If passed in, Aptos Aggregator load can be skipped
  feedConfigs?: AggregatorConfigs;

  // If passed in, Aptos Queue load can be skipped
  queue?: Queue;
  solanaQueue?: SolanaQueue;
}

export interface CurrentResult {
  maxResult: BN;
  maxTimestamp: number;
  mean: BN;
  minResult: BN;
  minTimestamp: number;
  range: BN;
  result: BN;
  stdev: BN;
}

export interface Update {
  oracle: string;
  value: BN;
  timestamp: number;
}

export interface AggregatorData {
  address: string;
  authority: string;
  createdAt: number;
  currentResult: CurrentResult;
  feedHash: string;
  maxStalenessSeconds: number;
  maxVariance: number;
  minResponses: number;
  minSampleSize: number;
  name: string;
  queue: string;
  updateState: {
    currIdx: number;
    results: Update[];
  };
}

export class Aggregator {
  public crossbarClient?: CrossbarClient;
  public feedHash?: string;

  constructor(readonly client: SwitchboardClient, readonly address: string) {}

  public static async initTx(
    client: SwitchboardClient,
    sender: string,
    options: AggregatorInitParams
  ): Promise<SimpleTransaction> {
    const { switchboardAddress, oracleQueue } = await client.fetchState(
      options
    );

    const feePayer = options.feePayer
      ? AccountAddress.fromString(options.feePayer)
      : undefined;
    const transaction = await client.aptos.transaction.build.simple({
      sender,
      data: {
        function: `${switchboardAddress}::aggregator_init_action::run`,
        functionArguments: [
          oracleQueue,
          options.name,
          Array.from(Buffer.from(options.feedHash.slice(2), "hex")),
          options.minSampleSize,
          options.maxStalenessSeconds,
          options.maxVariance,
          options.minResponses,
        ],
      },
      withFeePayer: !!feePayer,
    });
    if (feePayer) transaction.feePayerAddress = feePayer;

    return transaction;
  }

  /**
   * Set configs for the Aggregator
   * @param tx - Transaction
   * @param options - AggregatorConfigParams
   */
  public async setConfigsTx(
    sender: string,
    options: AggregatorConfigParams
  ): Promise<SimpleTransaction> {
    const { switchboardAddress } = await this.client.fetchState(options);

    const feePayer = options.feePayer
      ? AccountAddress.fromString(options.feePayer)
      : undefined;
    const transaction = await this.client.aptos.transaction.build.simple({
      sender,
      data: {
        function: `${switchboardAddress}::aggregator_set_configs_action::run`,
        functionArguments: [
          this.address,
          options.name,
          Array.from(Buffer.from(options.feedHash.slice(2), "hex")),
          options.minSampleSize,
          options.maxStalenessSeconds,
          options.maxVariance,
          options.minResponses,
        ],
      },
      withFeePayer: !!feePayer,
    });
    if (feePayer) transaction.feePayerAddress = feePayer;

    return transaction;
  }

  /**
   * Set the feed authority
   * @param tx - Transaction
   * @param options - AggregatorSetAuthorityParams
   */
  public async setAuthorityTx(
    options: AggregatorSetAuthorityParams
  ): Promise<SimpleTransaction> {
    const { switchboardAddress } = await this.client.fetchState(options);

    const feePayer = options.feePayer
      ? AccountAddress.fromString(options.feePayer)
      : undefined;
    const transaction = await this.client.aptos.transaction.build.simple({
      sender: options.newAuthority,
      data: {
        function: `${switchboardAddress}::aggregator_set_authority_action::run`,
        functionArguments: [this.address, options.newAuthority],
      },
      withFeePayer: !!feePayer,
    });
    if (feePayer) transaction.feePayerAddress = feePayer;

    return transaction;
  }

  /**
   * Fetch the update transaction
   * @param sender - Sender
   * @param options - AggregatorFetchUpdateIxParams
   * @returns - FetchUpdateTxResponse
   */
  public async fetchUpdate(options?: AggregatorFetchUpdateIxParams): Promise<{
    responses: FeedEvalResponse[];
    failures: string[];
    updates: number[][];
    updateTx?: SimpleTransaction;
  }> {
    let { switchboardAddress, oracleQueue } = await this.client.fetchState(
      options
    );

    // get the feed configs if we need them / they aren't passed in
    let feedConfigs = options?.feedConfigs;
    if (!feedConfigs) {
      const aggregatorData = await this.loadData();
      oracleQueue = aggregatorData.queue;
      feedConfigs = {
        minSampleSize: aggregatorData.minSampleSize,
        feedHash: aggregatorData.feedHash,
        maxVariance: aggregatorData.maxVariance,
        minResponses: aggregatorData.minResponses,
      };
    }

    if (!oracleQueue) {
      throw new Error("[fetchUpdateTx]: ORACLE QUEUE NOT FOUND");
    }

    // get the queue from cache
    let aptosQueue = aptosQueueCache.get(oracleQueue);
    if (!aptosQueue) {
      const queue = await new Queue(this.client, oracleQueue).loadData();
      aptosQueueCache.set(oracleQueue, queue);
      aptosQueue = queue;
    }

    // load the solana queue from cache or fetch it
    let solanaQueue: SolanaQueue = options?.solanaQueue;
    if (!solanaQueue) {
      if (aptosQueue.queueKey === ON_DEMAND_MAINNET_QUEUE.toBase58()) {
        solanaQueue = solanaProgramCache.get(
          ON_DEMAND_MAINNET_QUEUE.toBase58()
        );
        if (!solanaQueue) {
          solanaQueue = await getDefaultQueue(options?.solanaRPCUrl);
          solanaProgramCache.set(
            ON_DEMAND_MAINNET_QUEUE.toBase58(),
            solanaQueue
          );
        }
      } else if (aptosQueue.queueKey === ON_DEMAND_DEVNET_QUEUE.toBase58()) {
        solanaQueue = solanaProgramCache.get(ON_DEMAND_DEVNET_QUEUE.toBase58());
        if (!solanaQueue) {
          solanaQueue = await getDefaultDevnetQueue(options?.solanaRPCUrl);
          solanaProgramCache.set(
            ON_DEMAND_DEVNET_QUEUE.toBase58(),
            solanaQueue
          );
        }
      } else {
        throw new Error("[fetchUpdateTx]: QUEUE NOT FOUND");
      }
    }

    // fail out if we can't load the queue
    if (!solanaQueue) {
      throw new Error(
        `Could not load the Switchboard Queue - Queue pubkey: ${aptosQueue.queueKey}`
      );
    }

    // get the crossbar client
    const crossbarClient =
      options?.crossbarClient ??
      new CrossbarClient(
        options?.crossbarUrl ?? "https://crossbar.switchboard.xyz"
      );

    // fetch the jobs
    const jobs: OracleJob[] =
      options?.jobs ??
      (await crossbarClient
        .fetch(feedConfigs.feedHash)
        .then((res) => res.jobs.map((job) => OracleJob.fromObject(job))));

    const fetchUpdateData = async () => {
      // fetch the signatures
      const { responses, failures } = await solanaQueue.fetchSignatures({
        jobs,
        gateway: options?.gateway,

        // Make this more granular in the canonical fetch signatures (within @switchboard-xyz/on-demand)
        maxVariance: Math.floor(feedConfigs.maxVariance / 1e9),
        minResponses: feedConfigs.minResponses,
        numSignatures: feedConfigs.minSampleSize,

        // blockhash checks aren't possible yet on SUI
        recentHash: bs58.encode(new Uint8Array(32)),
        useTimestamp: true,
      });

      // filter out responses that don't have available oracles
      const validOracles = new Set(
        aptosQueue.existingOracles.map((o) => o.oracleKey)
      );

      // filter out responses that don't have available oracles
      const validResponses = responses.filter((r) => {
        let key = hexToB58(r.oracle_pubkey) && r.success_value;
        return validOracles.has(key);
      });

      if (!validResponses.length) {
        let failures = Array.from(
          new Set(responses.map((r) => r.failure_error).filter(Boolean))
        ).join(", ");
        throw new Error(`No valid responses found. Failures: ${failures}`);
      }

      // update strings to build the single update string
      const updates = [];

      // map the responses into the tx
      for (const response of validResponses) {
        let key = hexToB58(response.oracle_pubkey);
        const oracle = aptosQueue.existingOracles.find(
          (o) => o.oracleKey === key
        );

        if (!oracle) {
          return;
        }

        // Get the data from the response
        const signature = Array.from(Buffer.from(response.signature, "base64"));
        signature.push(response.recovery_id);
        const aggregatorAddress = this.address;
        const timestamp = response.timestamp;
        const value = response.success_value;

        // build update array
        const updateBytes = [];
        // discriminator
        updateBytes.push(1);

        // format the feed address
        const feedAddress = Array.from(
          Buffer.from(
            aggregatorAddress.startsWith("0x")
              ? aggregatorAddress.slice(2)
              : aggregatorAddress,
            "hex"
          )
        );
        if (feedAddress.length < 32) {
          feedAddress.unshift(0);
        }

        // push feed address
        updateBytes.push(...feedAddress);

        // push value
        updateBytes.push(...Array.from(this.i128ToUint8Array(BigInt(value))));

        // push r
        updateBytes.push(...signature.slice(0, 32));

        // push s
        updateBytes.push(...signature.slice(32, 64));

        // push v
        updateBytes.push(signature[64]);

        // push block number (zeroed out for now - bytes32 0)
        updateBytes.push(...Array(8).fill(0));

        // push timestamp
        const timestampBuffer = Buffer.alloc(8);
        timestampBuffer.writeBigInt64BE(BigInt(timestamp), 0);
        updateBytes.push(...Array.from(timestampBuffer));

        // push oracle address
        updateBytes.push(...Array.from(bs58.decode(oracle.oracleKey)));

        // push the update bytes
        updates.push(updateBytes);
      }

      let updateTx: SimpleTransaction | undefined;
      if (options?.sender) {
        const feePayer = options.feePayer
          ? AccountAddress.fromString(options.feePayer)
          : undefined;
        updateTx = await this.client.aptos.transaction.build.simple({
          sender: options.sender,
          data: {
            function: `${switchboardAddress}::update_action::run`,
            functionArguments: [updates],
            typeArguments: [APTOS_COIN],
          },
          withFeePayer: !!feePayer,
        });
        if (feePayer) updateTx.feePayerAddress = feePayer;
      }

      return { responses, failures, updates, updateTx };
    };

    // try to fetch the update data (retry up to 3 times)
    let fetchUpdateDataRetries = 0;
    let fetchUpdateDataResponse: {
      responses: FeedEvalResponse[];
      failures: string[];
      updates: number[][];
      updateTx: SimpleTransaction;
    };

    // try to fetch the update data (retry up to 5 times)
    while (fetchUpdateDataRetries < 5) {
      try {
        fetchUpdateDataResponse = await fetchUpdateData();
        break;
      } catch (e) {
        fetchUpdateDataRetries++;
        console.log(`[Switchboard Aptos] Fetch Update Data Error: ${e}`);
        console.log("Failed to fetch update data, retrying...");
      }
    }

    // fail out if we can't fetch the update data
    if (!fetchUpdateDataResponse) {
      throw new Error("Failed to fetch update data. Not enough responses.");
    }

    // return the response
    return fetchUpdateDataResponse;
  }

  public static parseAggregatorData(resource: any): AggregatorData {
    const data: AggregatorData = {
      address: resource.aggregator_address,
      authority: resource.authority,
      createdAt: parseInt(resource.created_at),
      currentResult: {
        maxResult: new BN(resource.current_result.max_result.value).mul(
          new BN(resource.current_result.max_result.neg ? -1 : 1)
        ),
        maxTimestamp: parseInt(resource.current_result.max_timestamp),
        mean: new BN(resource.current_result.mean.value).mul(
          new BN(resource.current_result.mean.neg ? -1 : 1)
        ),
        minResult: new BN(resource.current_result.min_result.value).mul(
          new BN(resource.current_result.min_result.neg ? -1 : 1)
        ),
        minTimestamp: parseInt(resource.current_result.min_timestamp),
        range: new BN(resource.current_result.range.value).mul(
          new BN(resource.current_result.range.neg ? -1 : 1)
        ),
        result: new BN(resource.current_result.result.value).mul(
          new BN(resource.current_result.result.neg ? -1 : 1)
        ),
        stdev: new BN(resource.current_result.stdev.value).mul(
          new BN(resource.current_result.stdev.neg ? -1 : 1)
        ),
      },
      feedHash: resource.feed_hash,
      maxStalenessSeconds: parseInt(resource.max_staleness_seconds),
      maxVariance: parseInt(resource.max_variance),
      minResponses: parseInt(resource.min_responses),
      minSampleSize: parseInt(resource.min_sample_size),
      name: resource.name,
      queue: resource.queue,
      updateState: {
        currIdx: parseInt(resource.update_state.curr_idx),
        results: resource.update_state.results.map((r: any) => {
          const oracle = r.oracle;
          const value = new BN(r.result.value).mul(
            r.result.neg ? new BN(-1) : new BN(1)
          );
          const timestamp = parseInt(r.timestamp);
          return {
            oracle,
            value,
            timestamp,
          };
        }),
      },
    };

    return data;
  }

  /**
   * Get the feed data object
   */
  public async loadData(): Promise<AggregatorData> {
    const { switchboardAddress } = await this.client.fetchState();
    const resources = await this.client.aptos.view({
      payload: {
        function: `${switchboardAddress}::aggregator::view_aggregator`,
        functionArguments: [this.address],
      },
    });
    const resource = resources[0] as any;
    // return the data object
    return Aggregator.parseAggregatorData(resource);
  }

  /**
   * Load all feeds
   */
  public static async loadAllFeeds(switchboardClient: SwitchboardClient) {
    const { switchboardAddress, oracleQueue } =
      await switchboardClient.fetchState();
    const resourcesResponse = await switchboardClient.aptos.view({
      payload: {
        function: `${switchboardAddress}::aggregator::view_queue_aggregators`,
        functionArguments: [oracleQueue],
      },
    });
    const resources = resourcesResponse[0] as any;
    const aggregators: AggregatorData[] = resources.map((resource: any) =>
      this.parseAggregatorData(resource)
    );
    return aggregators;
  }

  private i128ToUint8Array(value: bigint): Uint8Array {
    // Prepare an array of 16 bytes (128 bits).
    const result = new Uint8Array(16);

    // Convert the absolute value to Big-Endian bytes
    let absValue = value < 0 ? -value : value;
    for (let i = 15; i >= 0; i--) {
      result[i] = Number(absValue & BigInt(0xff));
      absValue = absValue >> BigInt(8);
    }

    // If it's a negative number, apply two's complement
    if (value < 0) {
      for (let i = 0; i < 16; i++) {
        result[i] = ~result[i] & 0xff;
      }

      // Add one to complete the two's complement
      for (let i = 15; i >= 0; i--) {
        result[i] = (result[i] + 1) & 0xff;
        if (result[i] !== 0) break; // Stop if there was no overflow
      }
    }

    return result;
  }
}

// Alias Aggregator to PullFeed
export const PullFeed = Aggregator;
