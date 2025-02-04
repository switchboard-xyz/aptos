import type { CommonOptions, OracleData, SwitchboardClient } from "../index.js";
import { SimpleTransaction } from "@aptos-labs/ts-sdk";
import { bs58 } from "@switchboard-xyz/common";

export interface QueueInitParams extends CommonOptions {
  queueKey: string;
  authority: string;
  name: string;
  fee: number;
  feeRecipient: string;
  minAttestations: number;
  oracleValidityLength: number;
  guardianQueue?: string;
  isGuardianQueue?: boolean;
}

export interface QueueSetConfigsParams extends CommonOptions {
  name: string;
  fee: number;
  feeRecipient: string;
  minAttestations: number;
  oracleValidityLength: number;
}

export interface QueueSetAuthorityParams extends CommonOptions {
  newAuthority: string;
}

export interface QueueOverrideOracleParams extends CommonOptions {
  oracle: string;
  secp256k1Key: Uint8Array;
  mrEnclave: Uint8Array;
  expirationTime: number;
}

export interface QueueSetFeeTypeParams extends CommonOptions {
  feeType: string;
}

export interface QueueData {
  authority: string;
  existingOracles: {
    oracle: string;
    oracleKey: string;
  }[];
  fee: number;
  feeRecipient: string;
  feeTypes: string[];
  guardianQueue: string;
  address: string;
  lastQueueOverride: number;
  minAttestations: number;
  name: string;
  oracleValidityLength: number;
  queueKey: string;
}

export class Queue {
  constructor(readonly client: SwitchboardClient, readonly address: string) {}

  /**
   * Create a new Queue
   */
  public static async initTx(
    client: SwitchboardClient,
    sender: string,
    options: QueueInitParams
  ): Promise<SimpleTransaction> {
    const { switchboardAddress } = await client.fetchState(options);
    if (options.isGuardianQueue) {
      return client.aptos.transaction.build.simple({
        sender,
        data: {
          function: `${switchboardAddress}::guardian_queue_init_action::run`,
          functionArguments: [
            Array.from(Buffer.from(options.queueKey, "hex")),
            options.name,
            options.fee,
            options.feeRecipient,
            options.minAttestations,
            options.oracleValidityLength,
          ],
        },
      });
    } else {
      if (!options.guardianQueue) {
        throw new Error("guardianQueueId is required for non-guardian queues");
      }
      return client.aptos.transaction.build.simple({
        sender,
        data: {
          function: `${switchboardAddress}::oracle_queue_init_action::run`,
          functionArguments: [
            Array.from(Buffer.from(options.queueKey, "hex")),
            options.name,
            options.fee,
            options.feeRecipient,
            options.minAttestations,
            options.oracleValidityLength,
            options.guardianQueue,
          ],
        },
      });
    }
  }

  /**
   * Queue set configs tx
   */
  public async setConfigsTx(
    sender: string,
    options: QueueSetConfigsParams
  ): Promise<SimpleTransaction> {
    const { switchboardAddress } = await this.client.fetchState(options);
    return this.client.aptos.transaction.build.simple({
      sender,
      data: {
        function: `${switchboardAddress}::queue_set_configs_action::run`,
        functionArguments: [
          this.address,
          options.name,
          options.fee,
          options.feeRecipient,
          options.minAttestations,
          options.oracleValidityLength,
        ],
      },
    });
  }

  /**
   * Queue set authority tx
   */
  public async setAuthorityTx(
    sender: string,
    options: QueueSetAuthorityParams
  ): Promise<SimpleTransaction> {
    const { switchboardAddress } = await this.client.fetchState(options);
    return this.client.aptos.transaction.build.simple({
      sender,
      data: {
        function: `${switchboardAddress}::queue_set_authority_action::run`,
        functionArguments: [this.address, options.newAuthority],
      },
    });
  }

  /**
   * Queue override oracle tx
   */
  public async overrideOracleTx(
    sender: string,
    options: QueueOverrideOracleParams
  ): Promise<SimpleTransaction> {
    const { switchboardAddress } = await this.client.fetchState(options);
    return this.client.aptos.transaction.build.simple({
      sender,
      data: {
        function: `${switchboardAddress}::queue_override_oracle_action::run`,
        functionArguments: [
          this.address,
          options.oracle,
          Array.from(options.secp256k1Key),
          Array.from(options.mrEnclave),
          options.expirationTime,
        ],
      },
    });
  }

  /**
   * Queue add fee type tx
   */
  public async addFeeTypeTx(sender: string, options: QueueSetFeeTypeParams) {
    const { switchboardAddress } = await this.client.fetchState(options);
    return this.client.aptos.transaction.build.simple({
      sender,
      data: {
        function: `${switchboardAddress}::queue_add_fee_coin_action::run`,
        functionArguments: [this.address],
        typeArguments: [options.feeType],
      },
    });
  }

  /**
   * Queue remove fee type tx
   */
  public async removeFeeTypeTx(sender: string, options: QueueSetFeeTypeParams) {
    const { switchboardAddress } = await this.client.fetchState(options);
    return this.client.aptos.transaction.build.simple({
      sender,
      data: {
        function: `${switchboardAddress}::queue_remove_fee_coin_action::run`,
        functionArguments: [this.address],
        typeArguments: [options.feeType],
      },
    });
  }

  private formatType(type: {
    account_address: string;
    module_name: string;
    struct_name: string;
  }): string {
    const decodedModuleName = Buffer.from(
      type.module_name.slice(2),
      "hex"
    ).toString("utf-8");
    const decodedStructName = Buffer.from(
      type.struct_name.slice(2),
      "hex"
    ).toString("utf-8");

    return `${type.account_address}::${decodedModuleName}::${decodedStructName}`;
  }

  /**
   * Get the queue data object
   */
  public async loadData(): Promise<QueueData> {
    const { switchboardAddress } = await this.client.fetchState();

    const resources = await this.client.aptos.view({
      payload: {
        function: `${switchboardAddress}::queue::view_queue`,
        functionArguments: [this.address],
      },
    });

    const resource = resources[0] as any;

    // parse the data into the correct types
    const data: QueueData = {
      authority: resource.authority,
      existingOracles: resource.all_oracles.map((o: any) => ({
        oracle: o.oracle,
        oracleKey: bs58.encode(Buffer.from(o.oracle_key.slice(2), "hex")),
      })),
      fee: parseInt(resource.fee),
      feeRecipient: resource.fee_recipient,
      feeTypes: resource.fee_types.map((ft: any) => this.formatType(ft)),
      guardianQueue: resource.guardian_queue,
      address: this.address,
      lastQueueOverride: parseInt(resource.last_queue_override),
      minAttestations: parseInt(resource.min_attestations),
      name: resource.name,
      oracleValidityLength: parseInt(resource.oracle_validity_length),
      queueKey: bs58.encode(Buffer.from(resource.queue_key.slice(2), "hex")),
    };

    return data;
  }

  public async loadOracles(): Promise<OracleData[]> {
    const { switchboardAddress } = await this.client.fetchState();
    const resourcesResponse = await this.client.aptos.view({
      payload: {
        function: `${switchboardAddress}::oracle::view_queue_oracles`,
        functionArguments: [this.address],
      },
    });

    if (resourcesResponse.length === 0) {
      return [];
    }

    const resources = resourcesResponse[0] as any;

    const oracles: OracleData[] = resources.map((resource: any) => {
      return {
        expirationTime: parseInt(resource.expiration_time),
        address: resource.oracle_address,
        mrEnclave: resource.mr_enclave,
        oracleKey: bs58.encode(
          Buffer.from(resource.oracle_key.slice(2), "hex")
        ),
        queue: resource.queue,
        queueKey: bs58.encode(Buffer.from(resource.queue_key.slice(2), "hex")),
        secp256k1Key: resource.secp256k1_key,
        validAttestations: resource.valid_attestations,
      };
    });
    return oracles;
  }
}
