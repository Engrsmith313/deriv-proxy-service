# Comprehensive Trading Rules and Validation System

## Overview

This document outlines the comprehensive trading rules and validation system implemented for the Deriv trading service. The system ensures strict compliance with specific trade requirements, focusing on RISE/FALL contract types with identical payout requirements.

## 🎯 Core Trading Rules

### 1. Contract Type Restrictions

**MANDATORY REQUIREMENTS:**
- ✅ **ONLY** RISE/FALL contract types from Deriv's "Ups & Downs" category
- ✅ **ONLY** Continuous Indices market types
- ❌ **BLOCKED**: All other contract types including:
  - Touch/No Touch contracts
  - Matches/Differs contracts
  - Higher/Lower contracts
  - Any other derivative contract types

**Contract Type Mapping:**
- `CALL` → `RISE`
- `PUT` → `FALL`
- `RISE` → `RISE` (direct)
- `FALL` → `FALL` (direct)

### 2. Payout Requirements

**PRIMARY REQUIREMENT:**
- Both RISE and FALL positions **MUST** have identical minimum payout of **95%**

**MARKET SELECTION ALGORITHM:**
1. **Priority 1**: Search Continuous Indices for markets where BOTH RISE and FALL have:
   - Payout ≥ 95%
   - Identical payout percentages
   - Select the market with the **HIGHEST** matching payout

2. **Fallback Logic**: If NO markets meet 95% minimum:
   - Find Continuous Indices market with highest identical payout for both positions
   - Both positions must still have **exactly the same** payout amount
   - Never execute if RISE and FALL have different payouts

### 3. Supported Markets

**Continuous Indices Symbols:**
- **Volatility Indices**: R_10, R_25, R_50, R_75, R_100
- **High-Frequency Indices**: 1HZ10V, 1HZ25V, 1HZ50V, 1HZ75V, 1HZ100V
- **Boom/Crash Indices**: BOOM300N, BOOM500N, BOOM1000N, CRASH300N, CRASH500N, CRASH1000N
- **Daily Reset Indices**: RDBEAR, RDBULL

## 🔧 Implementation Architecture

### Server-Side Components

#### 1. MarketSelectionService
- **Purpose**: Analyzes all Continuous Indices markets for optimal selection
- **Features**:
  - Real-time payout analysis for RISE/FALL positions
  - Caching mechanism (5-minute cache duration)
  - Comprehensive market scoring and selection
  - Detailed logging and audit trail

#### 2. Enhanced TradingService
- **Purpose**: Comprehensive validation and trade execution
- **Validation Stages**:
  1. Basic field validation
  2. Contract type mapping and validation
  3. Risk management checks
  4. Connection and balance verification
  5. Market selection and payout validation
  6. Trade execution with selected market

#### 3. Configuration Management
- **Environment Variables**:
  ```env
  MINIMUM_PAYOUT=95
  REQUIRE_IDENTICAL_PAYOUTS=true
  ALLOWED_CONTRACT_TYPES=RISE,FALL
  ALLOWED_MARKET_TYPES=continuous_indices
  ```

### API Endpoints

#### 1. Enhanced Trade Execution
**POST** `/api/trading/trade`

**Request:**
```json
{
  "symbol": "R_100",
  "amount": 10,
  "contractType": "CALL",
  "duration": 5,
  "durationUnit": "t"
}
```

**Enhanced Response:**
```json
{
  "success": true,
  "data": {
    "contractId": 123456789,
    "buyPrice": 9.50,
    "payout": 19.00,
    "selectedMarket": {
      "symbol": "R_100",
      "displayName": "Volatility 100 Index",
      "risePayoutPercentage": 95.5,
      "fallPayoutPercentage": 95.5,
      "selectionReason": "Priority 1: Highest payout (95.50%) meeting 95% minimum"
    },
    "contractTypeMapping": {
      "original": "CALL",
      "mapped": "RISE"
    }
  },
  "marketSelection": {
    "selectedMarket": "R_100",
    "totalMarketsAnalyzed": 17,
    "payoutDetails": {
      "rise": 95.5,
      "fall": 95.5,
      "meetsMinimumPayout": true,
      "hasIdenticalPayouts": true
    }
  }
}
```

#### 2. Market Analysis
**GET** `/api/trading/analyze-markets?amount=10&duration=5&durationUnit=t`

**Response:**
```json
{
  "success": true,
  "data": {
    "marketAnalysis": {
      "totalMarketsAnalyzed": 17,
      "eligibleMarkets": 12,
      "marketsAbove95Percent": 8,
      "selectedMarket": {
        "symbol": "R_100",
        "displayName": "Volatility 100 Index",
        "risePayoutPercentage": 95.5,
        "fallPayoutPercentage": 95.5
      }
    },
    "availableMarkets": [
      {
        "symbol": "R_100",
        "displayName": "Volatility 100 Index",
        "risePayoutPercentage": 95.5,
        "fallPayoutPercentage": 95.5,
        "hasIdenticalPayouts": true,
        "meetsMinimumPayout": true,
        "isEligible": true
      }
    ]
  }
}
```

#### 3. Clear Market Cache
**POST** `/api/trading/clear-market-cache`

## 🔍 Validation Points

### 1. Pre-execution Validation (n8n Workflow)
- Contract type validation and mapping
- Market analysis and selection
- Payout requirement verification
- User notification with market details

### 2. Server-side Validation (Safety Net)
- Double-check all client-side validations
- Market scanning and selection algorithm
- Comprehensive logging for audit purposes

### 3. Error Handling
**Error Response Format:**
```json
{
  "success": false,
  "error": "No markets with identical RISE/FALL payouts found",
  "message": "All available markets have different payout amounts",
  "validationDetails": {
    "stage": "market_selection",
    "availableMarkets": 17,
    "eligibleMarkets": 0,
    "minimumPayoutRequired": 95,
    "requireIdenticalPayouts": true
  }
}
```

## 📊 Market Selection Priority

### Priority Order:
1. **Continuous Indices** with payout ≥ 95% (both positions identical) → **SELECT HIGHEST**
2. **Continuous Indices** with highest available identical payout → **FALLBACK ONLY**
3. **Never proceed** if no markets have identical RISE/FALL payouts

### Selection Algorithm:
```javascript
// Priority 1: Premium markets (≥95% with identical payouts)
const premiumMarkets = eligibleMarkets.filter(m => m.meetsMinimumPayout);
if (premiumMarkets.length > 0) {
  return premiumMarkets.reduce((best, current) => 
    current.averagePayoutPercentage > best.averagePayoutPercentage ? current : best
  );
}

// Fallback: Highest identical payout (even if <95%)
return eligibleMarkets.reduce((best, current) => 
  current.averagePayoutPercentage > best.averagePayoutPercentage ? current : best
);
```

## 🚀 n8n Integration

### Enhanced Validation Function
Use the provided `Enhanced_n8n_Validation_Function.js` in your n8n workflow:

```javascript
// In n8n Function Node
const validation = await validateTradeWithMarketAnalysis({
  position: $json.position,
  deltaAmount: $json.deltaAmount,
  duration: $json.duration
});

if (!validation.success) {
  throw new Error(validation.error);
}

return validation;
```

### Workflow Integration Points:
1. **Pre-trade validation** with market analysis
2. **Market selection confirmation** in notifications
3. **Enhanced trade execution** with payout details
4. **Comprehensive error handling** with specific reasons

## 📝 Logging and Audit

### Comprehensive Logging:
- All market selection decisions
- Payout information for both RISE/FALL
- Contract type mappings
- Validation stage results
- Error conditions and reasons

### Audit Trail:
- Market analysis results
- Selection algorithm decisions
- Payout requirement compliance
- Trade execution details

## ⚙️ Configuration

### Environment Variables:
```env
# Trading Rules Configuration
MINIMUM_PAYOUT=95
REQUIRE_IDENTICAL_PAYOUTS=true
ALLOWED_CONTRACT_TYPES=RISE,FALL
ALLOWED_MARKET_TYPES=continuous_indices

# Market Selection
MARKET_CACHE_DURATION=300000  # 5 minutes
MAX_PAYOUT_DIFFERENCE=0.01    # 0.01% tolerance
```

### Deployment:
1. Update environment variables in Render
2. Deploy updated code
3. Test with market analysis endpoint
4. Update n8n workflows with enhanced validation

This comprehensive system ensures strict compliance with trading requirements while providing detailed feedback and audit capabilities.
