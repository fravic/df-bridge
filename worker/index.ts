import * as ethers from "ethers";
import * as redis from "redis";
import { zipObject } from "lodash";

import dfCoreAbi from "@darkforest_eth/contracts/abis/DarkForestCore.json";
import dfGettersAbi from "@darkforest_eth/contracts/abis/DarkForestGetters.json";
import {
  CORE_CONTRACT_ADDRESS as DF_CORE_CONTRACT_ADDRESS,
  GETTERS_CONTRACT_ADDRESS as DF_GETTERS_CONTRACT_ADDRESS,
  START_BLOCK as DF_START_BLOCK,
} from "@darkforest_eth/contracts";

import {
  LAST_BLOCK_PROCESSED_KEY,
  SUBSCRIBED_ETH_ADDRS_KEY,
} from "../common/constants";
import { DfArrival, DfArrivalEvent, DfPlanet } from "./types";
import { notifyOfArrival } from "./notify";

type RedisClient = ReturnType<typeof redis.createClient>;

const START_BLOCK = process.env.START_BLOCK || DF_START_BLOCK;
const MAIN_LOOP_SLEEP_MS = 10000;
const MAX_BLOCKS_TO_PROCESS_PER_LOOP = 100;

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
const dfGettersContract = new ethers.Contract(
  DF_GETTERS_CONTRACT_ADDRESS,
  dfGettersAbi,
  provider
);

async function getPlanetsForArrivalEvents(
  arrivalEvents: Array<DfArrivalEvent>
): Promise<{ [planetId: string]: DfPlanet }> {
  if (!arrivalEvents.length) {
    return {};
  }
  const planetIds = arrivalEvents.map((arrivalEvent) =>
    arrivalEvent.args.to.toString()
  );
  console.log("Querying planet ids:", planetIds);
  const bulkPlanets = await dfGettersContract.bulkGetPlanetsByIds(planetIds);
  console.log("Query planets result:", bulkPlanets);
  return zipObject(planetIds, bulkPlanets);
}

async function getArrivals(
  arrivalIds: Array<string>
): Promise<Array<DfArrival>> {
  const arrivals = [];
  for (const arrivalId of arrivalIds) {
    console.log("Fetching arrival with id:", arrivalId);
    arrivals.push(await dfContract.getPlanetArrival(arrivalId));
  }
  console.log("Arrivals query results:", arrivals);
  return arrivals;
}

async function notifySubscribersOfArrivals(
  redisClient: RedisClient,
  startBlock: number,
  endBlock: number
) {
  console.log("Querying arrival events from block", startBlock, "to", endBlock);
  const events: Array<DfArrivalEvent> = (await dfContract.queryFilter(
    dfContract.filters.ArrivalQueued(),
    startBlock,
    endBlock
  )) as any;
  console.log("Event query result:", events);

  if (!events.length) {
    return;
  }

  const planetsById = await getPlanetsForArrivalEvents(events);

  // Filter planet ids to only those that subscribers are interested in
  let filteredArrivalIds = [];
  const subscribedEthAddrsToIftttApiKeys = JSON.parse(
    (await redisClient.get(SUBSCRIBED_ETH_ADDRS_KEY)) || "{}"
  );
  for (const arrivalEvent of events) {
    const planetId = arrivalEvent.args.to.toString();
    const planet = planetsById[planetId];
    if (planet) {
      const iftttApiKeys = subscribedEthAddrsToIftttApiKeys[planet.owner] || [];
      if (iftttApiKeys.length) {
        filteredArrivalIds.push(arrivalEvent.args.arrivalId.toString());
      }
    }
  }

  if (!filteredArrivalIds) {
    return;
  }

  // Fetch arrivals and notify subscribers
  const arrivals = await getArrivals(filteredArrivalIds);
  for (const arrival of arrivals) {
    const planet = planetsById[arrival.toPlanet.toString()];
    if (planet) {
      const iftttApiKeys = subscribedEthAddrsToIftttApiKeys[planet.owner] || [];
      for (const iftttApiKey of iftttApiKeys) {
        await notifyOfArrival(iftttApiKey, arrival, planet);
      }
    }
  }
}

(async function main() {
  const redisClient = redis.createClient<any>({ url: process.env.REDIS_URL });
  redisClient.on("error", (err: any) => console.log("Redis Client Error", err));
  await redisClient.connect();
  let timeoutId;

  function queueNextLoop(lastBlockProcessed: string) {
    redisClient.set(LAST_BLOCK_PROCESSED_KEY, lastBlockProcessed);
    timeoutId = setTimeout(mainLoop, MAIN_LOOP_SLEEP_MS);
  }

  async function mainLoop() {
    console.log("----- Starting main loop execution");

    const lastBlockProcessed = await redisClient.get(LAST_BLOCK_PROCESSED_KEY);
    console.log("Last block processed:", lastBlockProcessed);
    const currentBlock = await provider.getBlockNumber();
    console.log("Current block:", currentBlock);
    const startBlockToProcess = Math.max(
      lastBlockProcessed ? Number(lastBlockProcessed) : Number(START_BLOCK),
      Number(START_BLOCK)
    );
    const endBlockToProcess = Math.min(
      startBlockToProcess + MAX_BLOCKS_TO_PROCESS_PER_LOOP,
      currentBlock
    );

    try {
      await notifySubscribersOfArrivals(
        redisClient,
        startBlockToProcess,
        endBlockToProcess
      );
    } catch (error) {
      console.error(
        `Error notifying subscribers of arrivals for blocks ${startBlockToProcess} to ${endBlockToProcess}:`,
        error
      );
    }

    return queueNextLoop(String(endBlockToProcess));
  }

  mainLoop();
})();
