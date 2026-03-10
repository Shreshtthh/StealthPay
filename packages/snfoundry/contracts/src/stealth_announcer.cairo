#[starknet::interface]
pub trait IStealthAnnouncer<TContractState> {
    /// Emit an announcement so recipients can scan for incoming stealth payments.
    /// Called by StealthPay contract after a deposit is made.
    fn announce(
        ref self: TContractState,
        ephemeral_pub_x: felt252,
        ephemeral_pub_y: felt252,
        stealth_commitment: felt252,
        view_tag: felt252,
        token: starknet::ContractAddress,
        amount: u256,
    );
}

#[starknet::contract]
pub mod StealthAnnouncer {
    use starknet::{ContractAddress, get_caller_address};
    use super::IStealthAnnouncer;

    // ───────────────────────── Events ─────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Announcement: Announcement,
    }

    /// The core announcement event. Recipients scan these to discover payments.
    /// `view_tag` is indexed (#[key]) so frontends can filter by tag via RPC,
    /// avoiding expensive ECDH computation on every event.
    #[derive(Drop, starknet::Event)]
    pub struct Announcement {
        #[key]
        pub view_tag: felt252,
        #[key]
        pub stealth_commitment: felt252,
        pub ephemeral_pub_x: felt252,
        pub ephemeral_pub_y: felt252,
        pub token: ContractAddress,
        pub amount: u256,
        pub caller: ContractAddress,
    }

    // ───────────────────────── Storage ─────────────────────────

    #[storage]
    struct Storage {}

    // ───────────────────────── External ─────────────────────────

    #[abi(embed_v0)]
    impl StealthAnnouncerImpl of IStealthAnnouncer<ContractState> {
        fn announce(
            ref self: ContractState,
            ephemeral_pub_x: felt252,
            ephemeral_pub_y: felt252,
            stealth_commitment: felt252,
            view_tag: felt252,
            token: ContractAddress,
            amount: u256,
        ) {
            self
                .emit(
                    Announcement {
                        view_tag,
                        stealth_commitment,
                        ephemeral_pub_x,
                        ephemeral_pub_y,
                        token,
                        amount,
                        caller: get_caller_address(),
                    },
                );
        }
    }
}
