// Module to notify subscribers of hostile arrivals heading to their planets

import { ApolloClient } from "@apollo/client/core";
import fetch from "isomorphic-fetch";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

import {
  ARRIVALS_SUBSCRIBED_ETH_ADDRS_KEY,
  ARRIVALS_DEPARTURE_TIME_HIGH_WATERMARK_KEY,
} from "../../common/constants";
import { RedisClient } from "../types";
import { ARRIVALS_QUERY } from "./queries";

const IFTTT_URL = `https://maker.ifttt.com/trigger/df_helm/with/key/{apiKey}?value1={body}`;
const BODY_TEMPLATE = "Hostile {energy} energy arriving at {planetName} {time}";
const MILLISECONDS_PER_SECOND = 1000;
const ARRIVAL_TIME_DELTA_CUTOFF_MINS = 2;

dayjs.extend(relativeTime);

async function notifyOfArrival(iftttApiKey: string, arrival: any) {
  const arrivalTime = dayjs(arrival.arrivalTime * MILLISECONDS_PER_SECOND);

  // Don't notify of arrival times that happened too far in the past
  if (dayjs().diff(arrivalTime, "minute") > ARRIVAL_TIME_DELTA_CUTOFF_MINS) {
    console.log("--- Discarding old arrival with time:", arrivalTime.fromNow());
    return;
  }

  const notifBody = BODY_TEMPLATE.replace(
    "{energy}",
    arrival.milliEnergyArriving
  )
    .replace("{planetName}", `Level ${arrival.toPlanet.planetLevel} Planet`)
    .replace("{time}", arrivalTime.fromNow());
  const iftttUrl = IFTTT_URL.replace("{apiKey}", iftttApiKey).replace(
    "{body}",
    notifBody
  );
  console.log("--- Sending push to", iftttUrl);
  await fetch(iftttUrl);
}

export async function notifyOfArrivals(
  client: ApolloClient<any>,
  redisClient: RedisClient
) {
  console.log("-- Begin notify of arrivals");
  const departureTimeGtStr = await redisClient.get(
    ARRIVALS_DEPARTURE_TIME_HIGH_WATERMARK_KEY
  );
  const departureTimeGt = departureTimeGtStr ? Number(departureTimeGtStr) : 0;
  const { data, error } = await client.query({
    query: ARRIVALS_QUERY,
    variables: {
      first: 10,
      departureTimeGt,
    },
  });
  if (error) {
    console.error("--- Error querying arrivals:", error);
    return;
  }
  const arrivals = data?.arrivals;
  if (!arrivals || !arrivals.length) {
    console.log("--- No arrivals returned");
    return;
  }

  const lastDepartureTime = data.arrivals[0].departureTime;
  console.log("--- Updating latest departure time to:", lastDepartureTime);
  await redisClient.set(
    ARRIVALS_DEPARTURE_TIME_HIGH_WATERMARK_KEY,
    String(lastDepartureTime)
  );

  console.log("--- Processing arrival count:", arrivals.length);
  const iftttApiKeysByEthAddress = JSON.parse(
    (await redisClient.get(ARRIVALS_SUBSCRIBED_ETH_ADDRS_KEY)) || "{}"
  );
  const notifyPromises = [];
  for (const arrival of arrivals) {
    const planetOwnerId = arrival.toPlanet.owner.id;
    if (arrival.player.id === planetOwnerId) {
      continue;
    }
    const iftttApiKeys = iftttApiKeysByEthAddress[planetOwnerId] || [];
    for (const iftttApiKey of iftttApiKeys) {
      notifyPromises.push(notifyOfArrival(iftttApiKey, arrival));
    }
  }
  console.log("--- Notification promise count:", notifyPromises.length);
  await Promise.all(notifyPromises);
}
