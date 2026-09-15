//! Pins the context-state account sizes the TS SDK hard-codes (`sdk/src/zk.ts` CONTEXT_SIZE).
use solana_zk_elgamal_proof_interface::proof_data::*;
use window_proofs::ix::context_size;

#[test]
fn context_sizes_match_the_sdk() {
    assert_eq!(context_size::<ZeroCiphertextProofContext>(), 33 + 96);
    assert_eq!(context_size::<CiphertextCommitmentEqualityProofContext>(), 33 + 128);
    assert_eq!(context_size::<PubkeyValidityProofContext>(), 33 + 32);
    assert_eq!(context_size::<BatchedRangeProofContext>(), 33 + 264);
    assert_eq!(context_size::<GroupedCiphertext2HandlesValidityProofContext>(), 33 + 160);
    assert_eq!(context_size::<BatchedGroupedCiphertext3HandlesValidityProofContext>(), 33 + 352);
}
