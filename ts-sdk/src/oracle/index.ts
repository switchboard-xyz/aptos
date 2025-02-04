import {
  SwitchboardClient,
  CommonOptions,
} from "../index.js";
import { SimpleTransaction } from "@aptos-labs/ts-sdk";

export interface OracleInitParams extends CommonOptions {
  oracleKey: string;
  isGuardian?: boolean;
}

export interface OracleAttestParams extends CommonOptions {
  minAttestations: number;
  isGuardian?: boolean;
  solanaRPCUrl?: string;
}
export interface OracleData {
  expirationTime: number;
  address: string;
  mrEnclave: string;
  oracleKey: string;
  queue: string;
  queueKey: string;
  secp256k1Key: string;
  validAttestations: any[];
}

export class Oracle {
  constructor(readonly client: SwitchboardClient, readonly address: string) {}

  /**
   * Create a new Oracle
   */
  public static async initTx(
    client: SwitchboardClient,
    sender: string,
    options: OracleInitParams
  ): Promise<SimpleTransaction> {
    const { switchboardAddress } = await client.fetchState(options);

    if (options.isGuardian && !options.guardianQueue) {
      throw new Error("Guardian queue is required for guardian oracle");
    } else if (!options.isGuardian && !options.oracleQueue) {
      throw new Error("Oracle queue is required for oracle");
    }

    return client.aptos.transaction.build.simple({
      sender,
      data: {
        function: `${switchboardAddress}::oracle_init_action::run`,
        functionArguments: [
          options.isGuardian ? options.guardianQueue : options.oracleQueue,
          Array.from(Buffer.from(options.oracleKey, "hex")),
        ],
      },
    });
  }

  /**
   * TODO: Oracle attest TX [switchboard internal]
   */
}
