import { BigNumber } from "ethers";

export type DfArrivalEvent = {
  args: {
    player: string;
    arrivalId: BigNumber;
    from: BigNumber;
    to: BigNumber;
    artifactId: BigNumber;
  };
};

export type DfPlanet = {
  owner: string;
  range: BigNumber;
  speed: BigNumber;
  defense: BigNumber;
  population: BigNumber;
  populationCap: BigNumber;
  populationGrowth: BigNumber;
  silverCap: BigNumber;
  silverGrowth: BigNumber;
  silver: BigNumber;
  planetLevel: BigNumber;
  planetType: number;
  isHomePlanet: boolean;
};
