import { gql } from "@apollo/client/core";

export const ARRIVALS_QUERY = gql`
  query ($first: Int!, $departureTimeGt: Int) {
    arrivals(
      orderBy: departureTime
      orderDirection: desc
      first: $first
      where: { departureTime_gt: $departureTimeGt }
    ) {
      id
      player {
        id
      }
      toPlanet {
        owner {
          id
        }
        defense
        milliEnergyLazy
        milliEnergyGrowth
        milliEnergyCap
        planetLevel
      }
      milliEnergyArriving
      arrivalTime
      departureTime
    }
  }
`;
