import { type Address, address } from "@solana/kit";

/** Program ids, fixed at Phase 0 and identical on localnet and devnet. */
export const PROGRAMS = {
  registry: address("3Q49UcynVxvbrV9zw4M9bkMKrsQ2x6YvHtY1tgAjgKpi"),
  auction: address("HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6"),
  oracle: address("78Z5vNDsujWjDZjKFp625tZ1QMjD44VEHKCFH3LmzfLV"),
  wrap: address("E2scxVy7CpoxWQRBXsrSteYBbuEeMu7Q4zXYMM5bvLX3"),
  credit: address("3C6zwULWtL7oQHcEQbL9myG2zaJ8CPanRvPrF18ifKcr"),
} as const satisfies Record<string, Address>;

export const ZK_ELGAMAL_PROOF_PROGRAM = address("ZkE1Gama1Proof11111111111111111111111111111");
export const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
export const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");
