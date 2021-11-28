import * as redis from "redis";
import { uniq } from "lodash";

import { ARRIVALS_SUBSCRIBED_ETH_ADDRS_KEY } from "../../common/constants";

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
  const currentAddrs = JSON.parse(
    (await client.get(ARRIVALS_SUBSCRIBED_ETH_ADDRS_KEY)) || "{}"
  );
  const ethAddrApiKeys = uniq(
    (currentAddrs[ethAddr] || []).concat([iftttApiKey])
  );
  const updatedAddrs = JSON.stringify({
    ...currentAddrs,
    [ethAddr]: ethAddrApiKeys,
  });
  await client.set(ARRIVALS_SUBSCRIBED_ETH_ADDRS_KEY, updatedAddrs);
}
