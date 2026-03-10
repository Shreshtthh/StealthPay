#[starknet::interface]
pub trait IStealthRegistry<TContractState> {
    /// Register the caller's stealth meta-address (spending + viewing public keys).
    /// Only x-coordinates are stored — full points can be recovered on-curve.
    fn register(ref self: TContractState, spend_pub_x: felt252, view_pub_x: felt252);

    /// Retrieve a user's registered meta-address.
    /// Returns (spend_pub_x, view_pub_x). Both zero if not registered.
    fn get_meta_address(self: @TContractState, user: starknet::ContractAddress) -> (felt252, felt252);

    /// Check if a user has registered a meta-address.
    fn is_registered(self: @TContractState, user: starknet::ContractAddress) -> bool;
}

#[starknet::contract]
pub mod StealthRegistry {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use super::IStealthRegistry;

    // ───────────────────────── Events ─────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        MetaAddressRegistered: MetaAddressRegistered,
    }

    #[derive(Drop, starknet::Event)]
    struct MetaAddressRegistered {
        #[key]
        user: ContractAddress,
        spend_pub_x: felt252,
        view_pub_x: felt252,
    }

    // ───────────────────────── Storage ─────────────────────────

    #[storage]
    struct Storage {
        /// user → spending public key x-coordinate
        spend_keys: Map<ContractAddress, felt252>,
        /// user → viewing public key x-coordinate
        view_keys: Map<ContractAddress, felt252>,
        /// user → whether they have registered
        registered: Map<ContractAddress, bool>,
    }

    // ───────────────────────── External ─────────────────────────

    #[abi(embed_v0)]
    impl StealthRegistryImpl of IStealthRegistry<ContractState> {
        fn register(ref self: ContractState, spend_pub_x: felt252, view_pub_x: felt252) {
            assert(spend_pub_x != 0, 'spend key cannot be zero');
            assert(view_pub_x != 0, 'view key cannot be zero');

            let caller = get_caller_address();

            self.spend_keys.write(caller, spend_pub_x);
            self.view_keys.write(caller, view_pub_x);
            self.registered.write(caller, true);

            self.emit(MetaAddressRegistered { user: caller, spend_pub_x, view_pub_x });
        }

        fn get_meta_address(self: @ContractState, user: ContractAddress) -> (felt252, felt252) {
            (self.spend_keys.read(user), self.view_keys.read(user))
        }

        fn is_registered(self: @ContractState, user: ContractAddress) -> bool {
            self.registered.read(user)
        }
    }
}
