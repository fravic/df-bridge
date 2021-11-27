import * as redis from "redis";

const REDIS_KEY_PREFIX = "df_bridge__";
export const SUBSCRIBED_ETH_ADDRS_KEY = `${REDIS_KEY_PREFIX}subscribed_eth_addr_to_iftt_api_key`;

export async function createClient() {
  const client = redis.createClient({ url: process.env.REDIS_URL });
  client.on("error", (err: any) => console.log("Redis Client Error", err));
  await client.connect();
  return client;
}

export async function addSubscribedEthAddr(
  ethAddr: string,
  iftttApiKey: string
) {
  const client = await createClient();
  await client.hSet(SUBSCRIBED_ETH_ADDRS_KEY, ethAddr, iftttApiKey);
}

export async function getIftttApiKeyForAddr(
  ethAddr: string
): Promise<string | undefined> {
  const client = await createClient();
  return await client.hGet(SUBSCRIBED_ETH_ADDRS_KEY, ethAddr);
}
