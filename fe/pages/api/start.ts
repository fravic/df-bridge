import type { NextApiRequest, NextApiResponse } from "next";
import * as ethers from "ethers";

import dfCoreAbi from "@darkforest_eth/contracts/abis/DarkForestCore.json";
import { CORE_CONTRACT_ADDRESS as DF_CORE_CONTRACT_ADDRESS } from "@darkforest_eth/contracts";

const POKT_NETWORK_RPC_URL =
  "https://poa-xdai.gateway.pokt.network/v1/lb/60b13899d3279c22da2a444d";

const provider = new ethers.providers.JsonRpcProvider(
  process.env.JSON_RPC_URL || POKT_NETWORK_RPC_URL
);
const dfContract = new ethers.Contract(
  DF_CORE_CONTRACT_ADDRESS,
  dfCoreAbi,
  provider
);
let isStarted = false;

type Data = {
  error?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (!isStarted) {
    const bulkPlanets = await dfContract.getNPlanets();
    console.log("Starting ethereum contract", bulkPlanets.toString());
    dfContract.on("ArrivalQueued", (event: any) => {
      console.log("ArrivalQueued: ", event);
    });
    isStarted = true;
  }
  res.status(200).json({});
}
