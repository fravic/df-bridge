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
import { PLANETS_QUERY } from "./queries";
import * as log from "../../common/log";

const IFTTT_URL = `https://maker.ifttt.com/trigger/df_helm/with/key/{apiKey}?value1={body}`;
const BODY_TEMPLATE = "Hostile {energy} energy arriving at {planetName} {time}";
const MILLISECONDS_PER_SECOND = 1000;
const ARRIVAL_TIME_DELTA_CUTOFF_MINS = 2;
const MAX_PLANETS_SUPPORTED = 1000;

dayjs.extend(relativeTime);

async function notifyOfArrival(iftttApiKey: string, arrival: any) {
  const arrivalTime = dayjs(arrival.arrivalTime * MILLISECONDS_PER_SECOND);

  // Don't notify of arrival times that happened too far in the past
  if (dayjs().diff(arrivalTime, "minute") > ARRIVAL_TIME_DELTA_CUTOFF_MINS) {
    log.log("Discarding old arrival with time: " + arrivalTime.fromNow(), 2);
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
  log.log("Sending push to: " + iftttUrl, 2);
  await fetch(iftttUrl);
}

export async function notifyOfArrivals(
  client: ApolloClient<any>,
  redisClient: RedisClient
) {
  log.verbose("Begin notify of arrivals", 1);
  const departureTimeGtStr = await redisClient.get(
    ARRIVALS_DEPARTURE_TIME_HIGH_WATERMARK_KEY
  );
  const departureTimeGt = departureTimeGtStr ? Number(departureTimeGtStr) : 0;

  const iftttApiKeysByEthAddress = JSON.parse(
    (await redisClient.get(ARRIVALS_SUBSCRIBED_ETH_ADDRS_KEY)) || "{}"
  );
  const playerAddrs = Object.keys(iftttApiKeysByEthAddress);
  let newDepartureTimeHighWatermark = departureTimeGt;

  for (const playerAddr of playerAddrs) {
    log.verbose(`Querying planets for player: ${playerAddr}`);
    const { data, error } = await client.query({
      fetchPolicy: "network-only",
      query: PLANETS_QUERY,
      variables: {
        owner: playerAddr.toLowerCase(),
        departureTimeGt,
        maxPlanets: MAX_PLANETS_SUPPORTED,
      },
    });

    if (error || !data) {
      log.error("Error querying planets: " + error, 2);
      continue;
    }

    const planets = data?.planets;
    const notifyPromises = [];
    const iftttApiKey = iftttApiKeysByEthAddress[playerAddr];

    log.verbose("Processing planet count: " + planets.length, 2);
    for (const planet of planets) {
      const arrivals = planet.voyagesTo;

      log.verbose("Processing arrival count: " + arrivals.length, 2);
      for (const arrival of arrivals) {
        newDepartureTimeHighWatermark = Math.max(newDepartureTimeHighWatermark, arrival.departureTime);
        notifyPromises.push(notifyOfArrival(iftttApiKey, arrival));
      }
    }

    log.verbose("Awaiting notification promise count: " + notifyPromises.length, 2);
    await Promise.all(notifyPromises);
  }

  if (newDepartureTimeHighWatermark !== departureTimeGt) {
    // TODO: May want to move high watermark to be per-player, to avoid re-notifying in case of errors
    log.log("Updating latest departure time to: " + newDepartureTimeHighWatermark, 2);
    await redisClient.set(
      ARRIVALS_DEPARTURE_TIME_HIGH_WATERMARK_KEY,
      String(newDepartureTimeHighWatermark)
    );
  }
}
