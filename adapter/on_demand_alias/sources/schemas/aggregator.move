module on_demand_adapter::aggregator {
    use aptos_framework::timestamp;
    use on_demand_adapter::math::{Self, SwitchboardDecimal};
    use on_demand_adapter::errors;
    use std::signer; 

    // New On-demand Dependencies
    use switchboard::aggregator::{
        Self as on_demand_aggregator, 
        Aggregator as OnDemandAggregator, 
        CurrentResult
    };
    use switchboard::decimal::{Self, Decimal};
    use aptos_framework::object::{Self, Object};
    
    /**
     * ON DEMAND
     * Check if an on-demand aggregator exists
     * @param addr: address of the aggregator
     * @return bool - whether the aggregator exists
     */
    public fun exist(addr: address): bool {
        let aggregator: Object<OnDemandAggregator> = object::address_to_object<OnDemandAggregator>(addr);
        on_demand_aggregator::aggregator_exists(aggregator)
    }

    /**
     * ON DEMAND
     * Check if the account has authority over the aggregator
     * @param addr: address of the aggregator
     * @param account: the account to check
     * @return bool - whether the account has authority
     */
    public fun has_authority(addr: address, account: &signer): bool {
        let aggregator: Object<OnDemandAggregator> = object::address_to_object<OnDemandAggregator>(addr);

        // check if the account has authority
        on_demand_aggregator::has_authority(
            aggregator, 
            signer::address_of(account)
        )
    }
    
    /**
     * ON DEMAND
     * Get the latest value for a feed
     * @param addr: address of the aggregator
     * @return SwitchboardDecimal - the latest value
     */
    public fun latest_value(addr: address): SwitchboardDecimal {
        let aggregator: Object<OnDemandAggregator> = object::address_to_object<OnDemandAggregator>(addr);

        // Get the latest update info for the feed
        let current_result: CurrentResult = on_demand_aggregator::current_result(aggregator);

        // get the current result
        let result: Decimal = on_demand_aggregator::result(&current_result);
        
        // result, create a new SwitchboardDecimal - scale down value from 18 decimals to 9
        let (value, neg) = decimal::unpack(result);
        let value_sbd = math::new(value / 1000000000, 9, neg);

        // get the timestamp
        let timestamp_seconds = on_demand_aggregator::timestamp(&current_result);
        
        // check if the timestamp is old
        let current_time = timestamp::now_seconds();
        let is_old = current_time - timestamp_seconds > 120;

        // error out if the data is older than 2 minutes
        assert!(!is_old, errors::PermissionDenied());

        // get the latest value and whether it's within the bounds
        value_sbd
    }

    /**
     * ON DEMAND
     * Get the latest value for a feed and check if the stdev of the reported values is within a certain threshold
     * @param addr: address of the aggregator
     * @param max_confidence_interval: the maximum confidence interval
     * @return (SwitchboardDecimal, bool) - the latest value and whether it's within the bounds
     */
    public fun latest_value_in_threshold(addr: address, max_confidence_interval: &SwitchboardDecimal): (SwitchboardDecimal, bool) {

        let aggregator: Object<OnDemandAggregator> = object::address_to_object<OnDemandAggregator>(addr);

        // Get the latest update info for the feed
        let current_result: CurrentResult = on_demand_aggregator::current_result(aggregator);

        // get the current result
        let result: Decimal = on_demand_aggregator::result(&current_result);
        let stdev = on_demand_aggregator::stdev(&current_result);
        
        // result, create a new SwitchboardDecimal - scale down value from 18 decimals to 9
        let (value, neg) = decimal::unpack(result);
        let value_sbd = math::new(value / 1000000000, 9, neg);

        // stdev
        let (std_dev, neg) = decimal::unpack(stdev);
        let std_deviation = math::new(std_dev / 1000000000, 9, neg);
        let is_within_bound = math::gt(&std_deviation, max_confidence_interval);

        // get the latest value and whether it's within the bounds
        (value_sbd, is_within_bound)
    }


    /**
     * ON_DEMAND
     * Latest Round
     * @param addr: address of the aggregator
     * @return (SwitchboardDecimal, u64, SwitchboardDecimal, SwitchboardDecimal, SwitchboardDecimal) - the latest round data
     */
    public fun latest_round(addr: address): (
        SwitchboardDecimal, /* Result */
        u64,                /* Round Confirmed Timestamp */
        SwitchboardDecimal, /* Standard Deviation of Oracle Responses */
        SwitchboardDecimal, /* Min Oracle Response */
        SwitchboardDecimal, /* Max Oracle Response */
    ) {

        let aggregator: Object<OnDemandAggregator> = object::address_to_object<OnDemandAggregator>(addr);

        // Get the latest update info for the feed
        let current_result: CurrentResult = on_demand_aggregator::current_result(aggregator);

        // get the current result
        let timestamp_seconds = on_demand_aggregator::timestamp(&current_result);
        let result: Decimal = on_demand_aggregator::result(&current_result);
        let stdev = on_demand_aggregator::stdev(&current_result);
        let min_response: Decimal = on_demand_aggregator::min_result(&current_result);
        let max_response: Decimal = on_demand_aggregator::max_result(&current_result);

        // result, create a new SwitchboardDecimal - scale down value from 18 decimals to 9
        let (value, neg) = decimal::unpack(result);
        let value_sbd = math::new(value / 1000000000, 9, neg);

        // stdev
        let (std_dev, neg) = decimal::unpack(stdev);
        let std_dev_sbd = math::new(std_dev / 1000000000, 9, neg);

        // min_response
        let (min, neg) = decimal::unpack(min_response);
        let min_sbd = math::new(min / 1000000000, 9, neg);

        // max_response
        let (max, neg) = decimal::unpack(max_response);
        let max_sbd = math::new(max / 1000000000, 9, neg);

        // supply the new on-demand data
        (
            value_sbd,
            timestamp_seconds,
            std_dev_sbd,
            min_sbd,
            max_sbd,
        )
    }

    /**
     * ON DEMAND
     * Get the current aggregator authority
     * @param addr: address of the aggregator
     * @return address - the authority address
     */
    public fun authority(addr: address): address {
        let aggregator: Object<OnDemandAggregator> = object::address_to_object<OnDemandAggregator>(addr);
        let aggregator_value = on_demand_aggregator::get_aggregator(aggregator);
        on_demand_aggregator::authority(&aggregator_value)
    }
}
