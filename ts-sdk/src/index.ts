import { TTLCache } from "@brokerloop/ttlcache";
import { 
  Queue as SolanaQueue, 
  ON_DEMAND_DEVNET_QUEUE as SWITCHBOARD_DEVNET_QUEUE,
  ON_DEMAND_MAINNET_QUEUE as SWITCHBOARD_MAINNET_QUEUE,
} from "@switchboard-xyz/on-demand";
import {
  Aptos,
  Network,
  ClientRequest,
  ClientResponse,
  MoveVector,
  U8,
} from "@aptos-labs/ts-sdk";
import { AxiosRequestConfig, default as axios } from "axios";

import type { QueueData } from "./queue/index.js";
export * from "./aggregator/index.js";
export * from "./oracle/index.js";
export * from "./queue/index.js";
export * from "@switchboard-xyz/common";

export const ON_DEMAND_MAINNET_QUEUE_KEY = SWITCHBOARD_MAINNET_QUEUE.toBase58();
export const ON_DEMAND_DEVNET_QUEUE_KEY = SWITCHBOARD_DEVNET_QUEUE.toBase58();

export const ON_DEMAND_MAINNET_ADDRESS = "0xfea54925b5ac1912331e2e62049849b37842efaea298118b66f85a59057752b8";
export const ON_DEMAND_MAINNET_QUEUE = "0x7fdf7235bf3bd872ad093927deb2ff5f1645d1b6dabbfd4a03c3e0442788ce12";
export const ON_DEMAND_MAINNET_GUARDIAN_QUEUE = "0x3434a45114f5f8fc577557a9a3dda54c1799fee5271313f2599a1093c4a8ba01";

export const ON_DEMAND_TESTNET_ADDRESS = "0x4fc1809ffb3c5ada6b4e885d4dbdbeb70cbdd99cbc0c8485965d95c2eab90935";
export const ON_DEMAND_TESTNET_QUEUE = "0xe898232691709ed4f47827a100aac2ca8ea5b27692b5d694b00cb4b2c714e760";
export const ON_DEMAND_TESTNET_GUARDIAN_QUEUE = "0x17ce931b15d5c4ca8f8e6a5b6b84e2aee44002e5fc5cb4cf00817bb462b56c4a";

export const ON_DEMAND_MOVEMENT_PORTO_ADDRESS = "0xfa416028d48a85cd7791c8a93c438ce8a750af333a53fde55b276fd4aa16275f";
export const ON_DEMAND_MOVEMENT_PORTO_QUEUE = "0x4e445d2968329979b34df2606a65e962ad15a540885fdcbb19eaf7a2a5bf4a22";
export const ON_DEMAND_MOVEMENT_PORTO_GUARDIAN_QUEUE = "0x63be642227d71ba56713d2cdb2efd13de0fb7d9783761e4d7f18327c7336f994";

// ==============================================================================
// Caching for Fetch Update Ix

// 1 min cache for sui cache
export const aptosQueueCache = new TTLCache<string, QueueData>({
  ttl: 1000 * 60,
});

// 5 min solana queue cache - reloads the sol program every 5 minutes max
export const solanaProgramCache = new TTLCache<string, SolanaQueue>({
  ttl: 1000 * 60 * 5,
});

// ==============================================================================

export interface SwitchboardState {
  switchboardAddress: string;
  guardianQueue: string;
  oracleQueue: string;
  mainnet: boolean;
}

export interface CommonOptions {
  switchboardAddress?: string;
  guardianQueue?: string;
  oracleQueue?: string;
  network?: Network;
}

export class SwitchboardClient {
  state: Promise<SwitchboardState | undefined>;

  constructor(readonly aptos: Aptos, readonly chain?: string) {
    this.state = this.fetchState();
  }

  /**
   * Fetch the correct addresses for the current network
   * @param retries Number of retries to fetch the state
   */
  async fetchState(
    options?: CommonOptions,
    retries: number = 3
  ): Promise<SwitchboardState> {
    if (retries <= 0) {
      throw new Error(
        "Failed to fetch Switchboard state after multiple attempts"
      );
    }


    const isMainnet = this.aptos.config.network === Network.MAINNET;
    const isAptos = this.chain === "aptos" || !this.chain;

    try {
      if (Network.MAINNET === this.aptos.config.network && isAptos) {
        return {
          switchboardAddress:
            options?.switchboardAddress ??
            ON_DEMAND_MAINNET_ADDRESS,
          guardianQueue: options?.guardianQueue ?? ON_DEMAND_MAINNET_GUARDIAN_QUEUE,
          oracleQueue: options?.oracleQueue ?? ON_DEMAND_MAINNET_QUEUE,
          mainnet: isMainnet,
        }
      } else if (Network.TESTNET === this.aptos.config.network && isAptos) {
        return {
          switchboardAddress:
            options?.switchboardAddress ??
            ON_DEMAND_TESTNET_ADDRESS,
          guardianQueue: options?.guardianQueue ?? ON_DEMAND_TESTNET_GUARDIAN_QUEUE,
          oracleQueue: options?.oracleQueue ?? ON_DEMAND_TESTNET_QUEUE,
          mainnet: isMainnet,
        };
      } else if (this.chain === "porto") {
        return {
          switchboardAddress:
            options?.switchboardAddress ??
            ON_DEMAND_MOVEMENT_PORTO_ADDRESS,
          guardianQueue: options?.guardianQueue ?? ON_DEMAND_MOVEMENT_PORTO_GUARDIAN_QUEUE,
          oracleQueue: options?.oracleQueue ?? ON_DEMAND_MOVEMENT_PORTO_QUEUE,
          mainnet: isMainnet,
        };
      }
    } catch (error) {
      console.error("Error fetching Switchboard state, retrying...");
      return this.fetchState(options, retries - 1);
    }
  }
}

export async function axiosAptosClient<Req, Res>(
  requestOptions: ClientRequest<Req>
): Promise<ClientResponse<Res>> {
  const { params, method, url, headers, body } = requestOptions;

  const customHeaders: any = {
    ...headers,
    customClient: true,
  };

  const config: AxiosRequestConfig = {
    url,
    method,
    headers: customHeaders,
    data: body,
    params,
  };

  try {
    const response = await axios(config);
    return {
      status: response.status,
      statusText: response.statusText,
      data: response.data,
      headers: response.headers,
      config: response.config,
      request: response.request,
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.message;
      const errorCode = error.response?.data?.error_code;

      if (errorMessage && errorCode) {
        console.error(`Error: ${errorMessage} (Code: ${errorCode})`);
      } else {
        console.error("An unknown error occurred.");
      }
    } else {
      console.error("An unexpected error occurred:", error);
    }
  }
}

export async function waitForTx(
  aptos: Aptos,
  transactionHash: string,
  maxRetries = 5,
  initialDelay = 500 // Start with a half-second delay
) {
  let retries = 0;
  let delay = initialDelay;

  while (retries < maxRetries) {
    try {
      const result = await aptos.waitForTransaction({
        transactionHash,
        options: {
          timeoutSecs: 30,
          checkSuccess: true,
        },
      });
      return result;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff: double the delay
      retries++;
    }
  }

  throw new Error(`Transaction not found after ${maxRetries} retries.`);
}

export function updateToBCS(update: number[][]): MoveVector<MoveVector<U8>> {
  return new MoveVector<MoveVector<U8>>(update.map((u) => MoveVector.U8(u)));
}
