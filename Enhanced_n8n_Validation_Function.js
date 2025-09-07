// Enhanced n8n Validation Function for Comprehensive Trading Rules
// This function should be used in n8n workflows before executing trades

async function validateTradeWithMarketAnalysis(tradeData) {
  const API_KEY = 'secure-production-key-2025';
  const BASE_URL = 'https://deriv-proxy-service-2.onrender.com';
  
  try {
    console.log('🔍 Starting comprehensive trade validation...', tradeData);
    
    // Step 1: Basic validation
    if (!tradeData.position || !['CALL', 'PUT', 'RISE', 'FALL'].includes(tradeData.position.toUpperCase())) {
      throw new Error(`❌ Invalid position type: ${tradeData.position}. Only CALL/PUT or RISE/FALL are allowed.`);
    }
    
    if (!tradeData.deltaAmount || tradeData.deltaAmount <= 0) {
      throw new Error(`❌ Invalid amount: ${tradeData.deltaAmount}. Amount must be positive.`);
    }
    
    const duration = tradeData.duration || 5;
    const amount = Number(tradeData.deltaAmount);
    
    // Step 2: Contract type mapping
    const contractTypeMapping = {
      'CALL': 'RISE',
      'PUT': 'FALL',
      'RISE': 'RISE',
      'FALL': 'FALL'
    };
    
    const mappedContractType = contractTypeMapping[tradeData.position.toUpperCase()];
    if (!mappedContractType) {
      throw new Error(`❌ Unsupported contract type: ${tradeData.position}. Only RISE/FALL (Ups & Downs) contracts are allowed.`);
    }
    
    console.log(`✅ Contract type mapped: ${tradeData.position} → ${mappedContractType}`);
    
    // Step 3: Market analysis
    console.log('📊 Analyzing markets for optimal selection...');
    
    const marketAnalysisResponse = await fetch(`${BASE_URL}/api/trading/analyze-markets?amount=${amount}&duration=${duration}&durationUnit=t`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      }
    });
    
    if (!marketAnalysisResponse.ok) {
      throw new Error(`❌ Market analysis failed: HTTP ${marketAnalysisResponse.status}`);
    }
    
    const marketAnalysis = await marketAnalysisResponse.json();
    
    if (!marketAnalysis.success) {
      throw new Error(`❌ Market analysis failed: ${marketAnalysis.message}`);
    }
    
    const analysis = marketAnalysis.data.marketAnalysis;
    const selectedMarket = analysis.selectedMarket;
    
    console.log('📈 Market Analysis Results:', {
      totalMarketsAnalyzed: analysis.totalMarketsAnalyzed,
      eligibleMarkets: analysis.eligibleMarkets,
      marketsAbove95Percent: analysis.marketsAbove95Percent,
      selectedMarket: selectedMarket?.symbol,
      selectionReason: analysis.selectionReason
    });
    
    // Step 4: Validation checks
    if (!analysis.selectionSuccess || !selectedMarket) {
      const errorMessage = `❌ No suitable market found!\n\n` +
        `📊 Analysis Summary:\n` +
        `• Total markets analyzed: ${analysis.totalMarketsAnalyzed}\n` +
        `• Eligible markets (identical payouts): ${analysis.eligibleMarkets}\n` +
        `• Markets above 95% payout: ${analysis.marketsAbove95Percent}\n\n` +
        `🚫 Reason: ${analysis.selectionReason}\n\n` +
        `⚠️ Trade cannot proceed without a market that meets the requirements:\n` +
        `• Both RISE and FALL must have identical payout percentages\n` +
        `• Minimum 95% payout preferred (fallback to highest available)\n` +
        `• Only Continuous Indices markets allowed`;
      
      throw new Error(errorMessage);
    }
    
    // Step 5: Payout validation
    const risePayoutPercentage = selectedMarket.risePayoutPercentage;
    const fallPayoutPercentage = selectedMarket.fallPayoutPercentage;
    const payoutDifference = Math.abs(risePayoutPercentage - fallPayoutPercentage);
    
    if (payoutDifference > 0.01) { // Allow 0.01% difference for rounding
      throw new Error(`❌ Payout validation failed!\n\n` +
        `Selected market: ${selectedMarket.displayName}\n` +
        `RISE payout: ${risePayoutPercentage.toFixed(2)}%\n` +
        `FALL payout: ${fallPayoutPercentage.toFixed(2)}%\n` +
        `Difference: ${payoutDifference.toFixed(2)}%\n\n` +
        `🚫 Both RISE and FALL positions must have identical payout percentages.`);
    }
    
    const meetsMinimumPayout = Math.min(risePayoutPercentage, fallPayoutPercentage) >= 95;
    
    // Step 6: Generate validation summary
    const validationSummary = {
      success: true,
      originalRequest: {
        position: tradeData.position,
        amount: amount,
        duration: duration
      },
      mappedRequest: {
        contractType: mappedContractType,
        symbol: selectedMarket.symbol,
        amount: amount,
        duration: duration,
        durationUnit: 't'
      },
      selectedMarket: {
        symbol: selectedMarket.symbol,
        displayName: selectedMarket.displayName,
        risePayoutPercentage: risePayoutPercentage,
        fallPayoutPercentage: fallPayoutPercentage,
        averagePayoutPercentage: selectedMarket.averagePayoutPercentage,
        meetsMinimumPayout: meetsMinimumPayout,
        hasIdenticalPayouts: selectedMarket.hasIdenticalPayouts
      },
      marketAnalysis: {
        totalMarketsAnalyzed: analysis.totalMarketsAnalyzed,
        eligibleMarkets: analysis.eligibleMarkets,
        marketsAbove95Percent: analysis.marketsAbove95Percent,
        selectionReason: analysis.selectionReason
      },
      validationChecks: {
        contractTypeValid: true,
        contractTypeMapped: `${tradeData.position} → ${mappedContractType}`,
        marketSelected: true,
        payoutsIdentical: selectedMarket.hasIdenticalPayouts,
        meetsMinimumPayout: meetsMinimumPayout,
        payoutPercentage: selectedMarket.averagePayoutPercentage
      },
      timestamp: new Date().toISOString()
    };
    
    // Step 7: Log success message
    const successMessage = `✅ TRADE VALIDATION SUCCESSFUL\n\n` +
      `🎯 Selected Market: ${selectedMarket.displayName}\n` +
      `📊 Payout: ${selectedMarket.averagePayoutPercentage.toFixed(2)}% (RISE: ${risePayoutPercentage.toFixed(2)}%, FALL: ${fallPayoutPercentage.toFixed(2)}%)\n` +
      `🏆 ${meetsMinimumPayout ? 'Meets 95% minimum payout requirement' : 'Below 95% minimum (fallback selection)'}\n` +
      `🔄 Contract Type: ${tradeData.position} → ${mappedContractType}\n` +
      `💰 Amount: $${amount}\n` +
      `⏱️ Duration: ${duration} ticks\n\n` +
      `📈 Market Analysis:\n` +
      `• ${analysis.totalMarketsAnalyzed} markets analyzed\n` +
      `• ${analysis.eligibleMarkets} eligible markets found\n` +
      `• ${analysis.marketsAbove95Percent} markets above 95% payout\n` +
      `• Selection reason: ${analysis.selectionReason}\n\n` +
      `🚀 Ready to execute trade!`;
    
    console.log(successMessage);
    
    return validationSummary;
    
  } catch (error) {
    console.error('❌ Trade validation failed:', error.message);
    
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      originalRequest: tradeData
    };
  }
}

// Usage in n8n Function Node:
// const tradeData = {
//   position: $json.position || 'CALL',
//   deltaAmount: $json.deltaAmount || $json.sentToExchange || 10,
//   duration: $json.duration || 5
// };
// 
// const validation = await validateTradeWithMarketAnalysis(tradeData);
// 
// if (!validation.success) {
//   throw new Error(validation.error);
// }
// 
// return validation;

// Export for n8n
return await validateTradeWithMarketAnalysis({
  position: $json.position || 'CALL',
  deltaAmount: $json.deltaAmount || $json.sentToExchange || 10,
  duration: $json.duration || 5
});
