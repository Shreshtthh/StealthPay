#[starknet::interface]
pub trait IStealthPay<TContractState> {
    /// Send tokens to a stealth address. The sender computes the stealth commitment
    /// and ephemeral key off-chain, then deposits tokens into this contract.
    ///
    /// Flow: transfer tokens → store deposit → call announcer.announce()
    fn send(
        ref self: TContractState,
        stealth_commitment: felt252,
        ephemeral_pub_x: felt252,
        ephemeral_pub_y: felt252,
        view_tag: felt252,
        token: starknet::ContractAddress,
        amount: u256,
        ipfs_cid: felt252,
    );

    /// Claim a stealth payment. The recipient proves ownership of the stealth private key
    /// by providing a valid ECDSA signature over the commitment.
    ///
    /// Flow: verify commitment → verify signature → mark claimed → transfer tokens
    fn claim(
        ref self: TContractState,
        stealth_commitment: felt252,
        stealth_pub_x: felt252,
        signature_r: felt252,
        signature_s: felt252,
        recipient: starknet::ContractAddress,
    );

    /// View a deposit's details
    fn get_deposit(self: @TContractState, commitment: felt252) -> (starknet::ContractAddress, u256, starknet::ContractAddress, bool);

    /// Get the announcer contract address
    fn get_announcer(self: @TContractState) -> starknet::ContractAddress;
}

#[starknet::contract]
pub mod StealthPay {
    use core::ecdsa::check_ecdsa_signature;
    use core::poseidon::poseidon_hash_span;
    use openzeppelin_token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::IStealthPay;

    // Import announcer interface to call announce()
    use crate::stealth_announcer::{IStealthAnnouncerDispatcher, IStealthAnnouncerDispatcherTrait};

    // ───────────────────────── Events ─────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        PaymentSent: PaymentSent,
        PaymentClaimed: PaymentClaimed,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentSent {
        #[key]
        commitment: felt252,
        token: ContractAddress,
        amount: u256,
        sender: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentClaimed {
        #[key]
        commitment: felt252,
        recipient: ContractAddress,
        amount: u256,
    }

    // ───────────────────────── Storage ─────────────────────────

    #[storage]
    struct Storage {
        // Deposit data stored per-field using Maps (Cairo doesn't support struct values in Map)
        deposit_token: Map<felt252, ContractAddress>,
        deposit_amount: Map<felt252, u256>,
        deposit_sender: Map<felt252, ContractAddress>,
        deposit_claimed: Map<felt252, bool>,
        deposit_exists: Map<felt252, bool>,
        /// The announcer contract we call to emit events
        announcer: ContractAddress,
    }

    // ───────────────────────── Constructor ─────────────────────────

    #[constructor]
    fn constructor(ref self: ContractState, announcer_address: ContractAddress) {
        self.announcer.write(announcer_address);
    }

    // ───────────────────────── External ─────────────────────────

    #[abi(embed_v0)]
    impl StealthPayImpl of IStealthPay<ContractState> {
        fn send(
            ref self: ContractState,
            stealth_commitment: felt252,
            ephemeral_pub_x: felt252,
            ephemeral_pub_y: felt252,
            view_tag: felt252,
            token: ContractAddress,
            amount: u256,
            ipfs_cid: felt252,
        ) {
            // Validate inputs
            assert(amount > 0, 'Amount must be > 0');
            assert(stealth_commitment != 0, 'Invalid commitment');
            assert(!self.deposit_exists.read(stealth_commitment), 'Commitment already used');

            let caller = get_caller_address();
            let this = get_contract_address();

            // 1. Transfer tokens from sender to this contract
            let erc20 = IERC20Dispatcher { contract_address: token };
            erc20.transfer_from(caller, this, amount);

            // 2. Store the deposit
            self.deposit_token.write(stealth_commitment, token);
            self.deposit_amount.write(stealth_commitment, amount);
            self.deposit_sender.write(stealth_commitment, caller);
            self.deposit_claimed.write(stealth_commitment, false);
            self.deposit_exists.write(stealth_commitment, true);

            // 3. Call the announcer to emit the Announcement event (now with IPFS CID)
            let announcer = IStealthAnnouncerDispatcher {
                contract_address: self.announcer.read(),
            };
            announcer.announce(ephemeral_pub_x, ephemeral_pub_y, stealth_commitment, view_tag, token, amount, ipfs_cid);

            // 4. Emit our own PaymentSent event
            self.emit(PaymentSent { commitment: stealth_commitment, token, amount, sender: caller });
        }

        fn claim(
            ref self: ContractState,
            stealth_commitment: felt252,
            stealth_pub_x: felt252,
            signature_r: felt252,
            signature_s: felt252,
            recipient: ContractAddress,
        ) {
            // ── Checks ──
            assert(self.deposit_exists.read(stealth_commitment), 'Deposit does not exist');
            assert(!self.deposit_claimed.read(stealth_commitment), 'Already claimed');

            // Verify that hashing the stealth public key produces the commitment
            let computed_commitment = poseidon_hash_span(array![stealth_pub_x].span());
            assert(computed_commitment == stealth_commitment, 'Commitment mismatch');

            // Verify ECDSA signature over the commitment using the stealth public key
            // This proves the claimer knows the stealth private key
            let is_valid = check_ecdsa_signature(stealth_commitment, stealth_pub_x, signature_r, signature_s);
            assert(is_valid, 'Invalid signature');

            // ── Effects ──
            let amount = self.deposit_amount.read(stealth_commitment);
            let token = self.deposit_token.read(stealth_commitment);
            self.deposit_claimed.write(stealth_commitment, true);

            // ── Interactions ──
            let erc20 = IERC20Dispatcher { contract_address: token };
            erc20.transfer(recipient, amount);

            self.emit(PaymentClaimed { commitment: stealth_commitment, recipient, amount });
        }

        fn get_deposit(self: @ContractState, commitment: felt252) -> (ContractAddress, u256, ContractAddress, bool) {
            (
                self.deposit_token.read(commitment),
                self.deposit_amount.read(commitment),
                self.deposit_sender.read(commitment),
                self.deposit_claimed.read(commitment),
            )
        }

        fn get_announcer(self: @ContractState) -> ContractAddress {
            self.announcer.read()
        }
    }
}
