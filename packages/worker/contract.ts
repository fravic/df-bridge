import * as ethers from "ethers";
import { CORE_CONTRACT_ADDRESS as DF_CORE_CONTRACT_ADDRESS } from "@darkforest_eth/contracts";
import dfCoreAbi from "@darkforest_eth/contracts/abis/DarkForestCore.json";
import { DarkForestCore } from "@darkforest_eth/contracts/typechain";
import {
  decodeArtifactPointValues,
  decodeUpgradeBranches,
} from "@darkforest_eth/serde";
import {
  ContractCaller,
  createContract,
  EthConnection,
  PendingTransaction,
  TxExecutor,
} from "@darkforest_eth/network";

import { ContractConstants, MoveArgs, ZKArgIdx } from "df-client";
import { log } from "df-helm-common";
import { MoveSnarkContractCallArgs } from "@darkforest_eth/snarks";
import { ContractMethodName } from "@darkforest_eth/types";
import { CONTRACT_PRECISION } from "@darkforest_eth/constants";

const POKT_NETWORK_RPC_URL =
  "https://poa-xdai.gateway.pokt.network/v1/lb/60b13899d3279c22da2a444d";

export class ContractAPI {
  provider = new ethers.providers.JsonRpcProvider(
    process.env.JSON_RPC_URL || POKT_NETWORK_RPC_URL
  );

  ethConnection: EthConnection | null = null;
  contractCaller: ContractCaller = new ContractCaller();
  coreContract: DarkForestCore | null = null;
  contractConstants: ContractConstants | null = null;
  txExecutor: TxExecutor | null = null;

  public async init() {
    this.ethConnection = new EthConnection(
      this.provider,
      await this.provider.getBlockNumber()
    );
    const playerSecretKey = process.env.PLAYER_SECRET_KEY;
    if (playerSecretKey) {
      this.ethConnection.setAccount(playerSecretKey);
    }
    const coreContractAddress =
      process.env.DF_CORE_CONTRACT_ADDRESS || DF_CORE_CONTRACT_ADDRESS;
    await this.ethConnection.loadContract<DarkForestCore>(
      coreContractAddress,
      (
        address: string,
        provider: ethers.providers.JsonRpcProvider,
        signer?: ethers.Wallet
      ) => {
        return Promise.resolve(
          createContract<DarkForestCore>(address, dfCoreAbi, provider, signer)
        );
      }
    );
    this.coreContract =
      this.ethConnection.getContract<DarkForestCore>(coreContractAddress);
    this.txExecutor = new TxExecutor(
      this.ethConnection,
      () => "10" // Gas fee, hardcoded for now
    );
  }

  public async makeCall<T>(
    contractViewFunction: ethers.ContractFunction<T>,
    args: unknown[] = []
  ): Promise<T> {
    return await this.contractCaller.makeCall(contractViewFunction, args);
  }

  private async fetchGameConstants() {
    log.verbose("Loading game constants...");
    const gameConstants = await this.makeCall(this.coreContract!.gameConstants);
    log.verbose("Loaded game constants");
    return gameConstants;
  }

  private async fetchSnarkConstants() {
    log.verbose("Loading snark constants...");
    const snarkConstants = await this.makeCall(
      this.coreContract!.snarkConstants
    );
    log.verbose("Loaded snark constants");
    return snarkConstants;
  }

  private async fetchDefaultStatus() {
    log.verbose("Loading default stats...");
    const defaultStats = await this.makeCall(
      this.coreContract!.getDefaultStats
    );
    log.verbose("Loaded default stats");
    return defaultStats;
  }

  private async fetchPlanetLevelThresholds() {
    log.verbose("Loading planet level thresholds...");
    const planetLevelThresholds = await this.makeCall(
      this.coreContract!.getPlanetLevelThresholds
    );
    log.verbose("Loaded planet level thresholds");
    return planetLevelThresholds;
  }

  private async fetchCumulativeRarities() {
    log.verbose("Loading planet cumulative rarities...");
    const planetCumulativeRarities = await this.makeCall(
      this.coreContract!.getCumulativeRarities
    );
    log.verbose("Loaded planet cumulative rarities");
    return planetCumulativeRarities;
  }

  private async fetchUpgradeBranches() {
    log.verbose("Loading upgrade branches...");
    const upgradeBranches = await this.makeCall(this.coreContract!.getUpgrades);
    log.verbose("Loaded upgrade branches");
    return upgradeBranches;
  }

  public async fetchContractConstants(): Promise<ContractConstants> {
    if (this.contractConstants) {
      return this.contractConstants;
    }
    const [
      gameConstants,
      snarkConstants,
      defaultStats,
      planetLevelThresholds,
      planetCumulativeRarities,
      upgradeBranches,
    ] = await Promise.all([
      this.fetchGameConstants(),
      this.fetchSnarkConstants(),
      this.fetchDefaultStatus(),
      this.fetchPlanetLevelThresholds(),
      this.fetchCumulativeRarities(),
      this.fetchUpgradeBranches(),
    ]);
    this.contractConstants = {
      DISABLE_ZK_CHECKS: snarkConstants.DISABLE_ZK_CHECKS,

      PLANETHASH_KEY: snarkConstants.PLANETHASH_KEY.toNumber(),
      SPACETYPE_KEY: snarkConstants.SPACETYPE_KEY.toNumber(),
      BIOMEBASE_KEY: snarkConstants.BIOMEBASE_KEY.toNumber(),
      PERLIN_LENGTH_SCALE: snarkConstants.PERLIN_LENGTH_SCALE.toNumber(),
      PERLIN_MIRROR_X: snarkConstants.PERLIN_MIRROR_X,
      PERLIN_MIRROR_Y: snarkConstants.PERLIN_MIRROR_Y,

      TOKEN_MINT_END_SECONDS: 0, // Don't know what this is

      MAX_NATURAL_PLANET_LEVEL:
        gameConstants.MAX_NATURAL_PLANET_LEVEL.toNumber(),
      TIME_FACTOR_HUNDREDTHS: gameConstants.TIME_FACTOR_HUNDREDTHS.toNumber(),

      PERLIN_THRESHOLD_1: gameConstants.PERLIN_THRESHOLD_1.toNumber(),
      PERLIN_THRESHOLD_2: gameConstants.PERLIN_THRESHOLD_2.toNumber(),
      PERLIN_THRESHOLD_3: gameConstants.PERLIN_THRESHOLD_3.toNumber(),
      INIT_PERLIN_MIN: gameConstants.INIT_PERLIN_MIN.toNumber(),
      INIT_PERLIN_MAX: gameConstants.INIT_PERLIN_MAX.toNumber(),
      SPAWN_RIM_AREA: gameConstants.SPAWN_RIM_AREA.toNumber(),
      BIOME_THRESHOLD_1: gameConstants.BIOME_THRESHOLD_1.toNumber(),
      BIOME_THRESHOLD_2: gameConstants.BIOME_THRESHOLD_2.toNumber(),
      PLANET_RARITY: gameConstants.PLANET_RARITY.toNumber(),
      PLANET_TYPE_WEIGHTS: gameConstants.PLANET_TYPE_WEIGHTS,
      ARTIFACT_POINT_VALUES: decodeArtifactPointValues(
        gameConstants.ARTIFACT_POINT_VALUES
      ),

      PHOTOID_ACTIVATION_DELAY:
        gameConstants.PHOTOID_ACTIVATION_DELAY.toNumber(),
      LOCATION_REVEAL_COOLDOWN:
        gameConstants.LOCATION_REVEAL_COOLDOWN.toNumber(),

      defaultPopulationCap: defaultStats.map((stats: any) =>
        stats.populationCap.toNumber()
      ),
      defaultPopulationGrowth: defaultStats.map((stats: any) =>
        stats.populationGrowth.toNumber()
      ),

      defaultSilverCap: defaultStats.map((stats: any) =>
        stats.silverCap.toNumber()
      ),
      defaultSilverGrowth: defaultStats.map((stats: any) =>
        stats.silverGrowth.toNumber()
      ),

      defaultRange: defaultStats.map((stats: any) => stats.range.toNumber()),
      defaultSpeed: defaultStats.map((stats: any) => stats.speed.toNumber()),
      defaultDefense: defaultStats.map((stats: any) =>
        stats.defense.toNumber()
      ),
      defaultBarbarianPercentage: defaultStats.map((stats: any) =>
        stats.barbarianPercentage.toNumber()
      ),

      planetLevelThresholds: planetLevelThresholds.map((x: ethers.BigNumber) =>
        x.toNumber()
      ),
      planetCumulativeRarities: planetCumulativeRarities.map(
        (x: ethers.BigNumber) => x.toNumber()
      ),

      upgrades: decodeUpgradeBranches(upgradeBranches),
    };
    return this.contractConstants;
  }

  public async fetchCurrentWorldRadius(): Promise<number> {
    const currentWorldRadius = await this.makeCall(
      this.coreContract!.worldRadius
    );
    log.verbose("Current world radius: " + currentWorldRadius);
    return currentWorldRadius.toNumber();
  }

  public async move(
    snarkArgs: MoveSnarkContractCallArgs,
    energy: number
  ): Promise<PendingTransaction> {
    const args = [
      snarkArgs[ZKArgIdx.PROOF_A],
      snarkArgs[ZKArgIdx.PROOF_B],
      snarkArgs[ZKArgIdx.PROOF_C],
      [
        ...snarkArgs[ZKArgIdx.DATA],
        Math.floor(energy * CONTRACT_PRECISION).toString(),
        "0",
        "0",
      ],
    ] as MoveArgs;
    const tx = this.txExecutor!.queueTransaction(
      this.getRandomActionId(),
      this.coreContract!,
      ContractMethodName.MOVE,
      args
    );
    return tx;
  }

  private getRandomActionId() {
    // From @darkforest_eth/Utils.ts
    const hex = "0123456789abcdef";
    let ret = "";
    for (let i = 0; i < 10; i += 1) {
      ret += hex[Math.floor(hex.length * Math.random())];
    }
    return ret;
  }
}
