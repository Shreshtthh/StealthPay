use contracts::stealth_announcer::{IStealthAnnouncerDispatcher, IStealthAnnouncerDispatcherTrait};
use openzeppelin_testing::declare_and_deploy;
use snforge_std::{spy_events, EventSpyAssertionsTrait, CheatSpan, cheat_caller_address};
use starknet::ContractAddress;

const TEST_SENDER: ContractAddress =
    0x02dA5254690b46B9C4059C25366D1778839BE63C142d899F0306fd5c312A5918
    .try_into()
    .unwrap();

fn deploy_announcer() -> ContractAddress {
    let calldata = array![];
    declare_and_deploy("StealthAnnouncer", calldata)
}

#[test]
fn test_announce_emits_event() {
    let announcer_addr = deploy_announcer();
    let dispatcher = IStealthAnnouncerDispatcher { contract_address: announcer_addr };

    let mut spy = spy_events();

    let ephemeral_pub_x: felt252 = 0xaabb;
    let ephemeral_pub_y: felt252 = 0xccdd;
    let commitment: felt252 = 0x1111;
    let view_tag: felt252 = 42;
    let token: ContractAddress = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
        .try_into()
        .unwrap();
    let amount: u256 = 1000;

    cheat_caller_address(announcer_addr, TEST_SENDER, CheatSpan::TargetCalls(1));
    let ipfs_cid: felt252 = 0x4950_4653; // test CID value
    dispatcher.announce(ephemeral_pub_x, ephemeral_pub_y, commitment, view_tag, token, amount, ipfs_cid);

    spy
        .assert_emitted(
            @array![
                (
                    announcer_addr,
                    contracts::stealth_announcer::StealthAnnouncer::Event::Announcement(
                        contracts::stealth_announcer::StealthAnnouncer::Announcement {
                            view_tag,
                            stealth_commitment: commitment,
                            ephemeral_pub_x,
                            ephemeral_pub_y,
                            token,
                            amount,
                            caller: TEST_SENDER,
                            ipfs_cid,
                        },
                    ),
                ),
            ],
        );
}
