import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM, PROGRAMS, TOKEN_2022_PROGRAM } from "./programs.js";

const enc = new TextEncoder();
const u64 = getU64Encoder();
const addr = getAddressEncoder();

async function pda(program: Address, seeds: ReadonlyUint8Array[]): Promise<Address> {
  const [a] = await getProgramDerivedAddress({ programAddress: program, seeds });
  return a;
}

export const registryConfig = () => pda(PROGRAMS.registry, [enc.encode("config")]);
export const member = (owner: Address) => pda(PROGRAMS.registry, [enc.encode("member"), addr.encode(owner)]);
export const auctionConfig = () => pda(PROGRAMS.auction, [enc.encode("config")]);
export const epoch = (index: bigint) => pda(PROGRAMS.auction, [enc.encode("epoch"), u64.encode(index)]);
export const bid = (epochIndex: bigint, owner: Address, side: 0 | 1, tick: number) =>
  pda(PROGRAMS.auction, [
    enc.encode("bid"),
    u64.encode(epochIndex),
    addr.encode(owner),
    new Uint8Array([side]),
    new Uint8Array([tick]),
  ]);
export const oracleState = () => pda(PROGRAMS.oracle, [enc.encode("oracle")]);
export const print = (index: bigint) => pda(PROGRAMS.oracle, [enc.encode("print"), u64.encode(index)]);
export const oracleAuthority = () => pda(PROGRAMS.oracle, [enc.encode("authority")]);
export const wrapVault = (mockMint: Address) => pda(PROGRAMS.wrap, [enc.encode("vault"), addr.encode(mockMint)]);
export const wrapMintAuthority = () => pda(PROGRAMS.wrap, [enc.encode("mint_authority")]);
export const creditConfig = () => pda(PROGRAMS.credit, [enc.encode("config")]);
/** `["listing", cstock_mint]` — one eligible collateral of the schedule. */
export const listing = (cstockMint: Address) => pda(PROGRAMS.credit, [enc.encode("listing"), addr.encode(cstockMint)]);
export const priceCache = (feedId: Uint8Array) => pda(PROGRAMS.credit, [enc.encode("price"), feedId]);
export const loan = (epochIndex: bigint, borrower: Address, bidTick: number, k: number) =>
  pda(PROGRAMS.credit, [
    enc.encode("loan"),
    u64.encode(epochIndex),
    addr.encode(borrower),
    new Uint8Array([bidTick]),
    new Uint8Array([k]),
  ]);
export const ata = (owner: Address, mint: Address) =>
  pda(ASSOCIATED_TOKEN_PROGRAM, [addr.encode(owner), addr.encode(TOKEN_2022_PROGRAM), addr.encode(mint)]);
