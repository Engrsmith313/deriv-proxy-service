import { DerivApiService } from './derivApi';
import { config } from '../config';
import logger from '../utils/logger';

export interface MarketInfo {
  symbol: string;
  displayName: string;
  marketType: string;
  submarket: string;
  risePayoutPercentage: number;
  fallPayoutPercentage: number;
  averagePayoutPercentage: number;
  hasIdenticalPayouts: boolean;
  meetsMinimumPayout: boolean;
  isEligible: boolean;
}

export interface MarketSelectionResult {
  success: boolean;
  selectedMarket?: MarketInfo;
  availableMarkets?: MarketInfo[];
  error?: string;
  message: string;
  selectionReason: string;
}

export interface ProposalRequest {
  symbol: string;
  contractType: 'RISE' | 'FALL';
  amount: number;
  duration: number;
  durationUnit: string;
}

export class MarketSelectionService {
  private derivApi: DerivApiService;
  private marketCache = new Map<string, MarketInfo>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // Continuous Indices symbols that support RISE/FALL contracts
  private readonly CONTINUOUS_INDICES_SYMBOLS = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
    'BOOM300N', 'BOOM500N', 'BOOM1000N',
    'CRASH300N', 'CRASH500N', 'CRASH1000N',
    'RDBEAR', 'RDBULL'
  ];

  constructor(derivApi: DerivApiService) {
    this.derivApi = derivApi;
  }

  public async selectOptimalMarket(
    amount: number,
    duration: number,
    durationUnit: string = 't'
  ): Promise<MarketSelectionResult> {
    try {
      logger.info('Starting market selection process', {
        amount,
        duration,
        durationUnit,
        minimumPayout: config.trading.minimumPayout
      });

      // Get market data for all continuous indices
      const marketData = await this.getMarketData(amount, duration, durationUnit);
      
      if (marketData.length === 0) {
        return {
          success: false,
          error: 'No markets available',
          message: 'No Continuous Indices markets are currently available',
          selectionReason: 'No markets found'
        };
      }

      // Apply selection algorithm
      const selectionResult = this.applyMarketSelectionAlgorithm(marketData);
      
      logger.info('Market selection completed', {
        selectedMarket: selectionResult.selectedMarket?.symbol,
        totalMarketsAnalyzed: marketData.length,
        eligibleMarkets: marketData.filter(m => m.isEligible).length,
        selectionReason: selectionResult.selectionReason
      });

      return {
        ...selectionResult,
        availableMarkets: marketData
      };

    } catch (error) {
      logger.error('Error in market selection:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to select optimal market',
        selectionReason: 'Selection process failed'
      };
    }
  }

  private async getMarketData(
    amount: number,
    duration: number,
    durationUnit: string
  ): Promise<MarketInfo[]> {
    const marketData: MarketInfo[] = [];

    for (const symbol of this.CONTINUOUS_INDICES_SYMBOLS) {
      try {
        // Check cache first
        const cacheKey = `${symbol}_${amount}_${duration}_${durationUnit}`;
        const cachedData = this.getFromCache(cacheKey);
        
        if (cachedData) {
          marketData.push(cachedData);
          continue;
        }

        // Get proposals for both RISE and FALL
        const [riseProposal, fallProposal] = await Promise.all([
          this.getProposal({ symbol, contractType: 'RISE', amount, duration, durationUnit }),
          this.getProposal({ symbol, contractType: 'FALL', amount, duration, durationUnit })
        ]);

        if (riseProposal && fallProposal) {
          const marketInfo = this.createMarketInfo(symbol, riseProposal, fallProposal);
          marketData.push(marketInfo);
          
          // Cache the result
          this.setCache(cacheKey, marketInfo);
        }

      } catch (error) {
        logger.warn(`Failed to get market data for ${symbol}:`, error);
        // Continue with other symbols
      }
    }

    return marketData;
  }

  private async getProposal(request: ProposalRequest): Promise<any> {
    try {
      const proposalRequest = {
        proposal: 1,
        amount: request.amount,
        basis: 'stake',
        contract_type: request.contractType,
        currency: 'USD',
        duration: request.duration,
        duration_unit: request.durationUnit,
        symbol: request.symbol,
        req_id: Date.now() + Math.random()
      };

      const response = await this.derivApi.sendRequest(proposalRequest);
      
      if (response.error) {
        logger.debug(`Proposal error for ${request.symbol} ${request.contractType}:`, response.error);
        return null;
      }

      return response.proposal;
    } catch (error) {
      logger.debug(`Failed to get proposal for ${request.symbol} ${request.contractType}:`, error);
      return null;
    }
  }

  private createMarketInfo(symbol: string, riseProposal: any, fallProposal: any): MarketInfo {
    const risePayoutPercentage = this.calculatePayoutPercentage(riseProposal);
    const fallPayoutPercentage = this.calculatePayoutPercentage(fallProposal);
    const averagePayoutPercentage = (risePayoutPercentage + fallPayoutPercentage) / 2;
    const hasIdenticalPayouts = Math.abs(risePayoutPercentage - fallPayoutPercentage) < 0.01; // Allow 0.01% difference
    const meetsMinimumPayout = Math.min(risePayoutPercentage, fallPayoutPercentage) >= config.trading.minimumPayout;
    const isEligible = hasIdenticalPayouts && (meetsMinimumPayout || !config.trading.requireIdenticalPayouts);

    return {
      symbol,
      displayName: this.getDisplayName(symbol),
      marketType: 'continuous_indices',
      submarket: this.getSubmarket(symbol),
      risePayoutPercentage,
      fallPayoutPercentage,
      averagePayoutPercentage,
      hasIdenticalPayouts,
      meetsMinimumPayout,
      isEligible
    };
  }

  private calculatePayoutPercentage(proposal: any): number {
    if (!proposal || !proposal.payout || !proposal.ask_price) {
      return 0;
    }
    
    const payout = parseFloat(proposal.payout);
    const askPrice = parseFloat(proposal.ask_price);
    
    if (askPrice === 0) return 0;
    
    return ((payout / askPrice) - 1) * 100;
  }

  private applyMarketSelectionAlgorithm(markets: MarketInfo[]): MarketSelectionResult {
    // Filter eligible markets (identical payouts)
    const eligibleMarkets = markets.filter(m => m.hasIdenticalPayouts);
    
    if (eligibleMarkets.length === 0) {
      return {
        success: false,
        error: 'No markets with identical RISE/FALL payouts found',
        message: 'All available markets have different payout amounts for RISE and FALL positions',
        selectionReason: 'No markets meet identical payout requirement'
      };
    }

    // Priority 1: Markets with payout >= 95% and identical payouts
    const premiumMarkets = eligibleMarkets.filter(m => m.meetsMinimumPayout);
    
    if (premiumMarkets.length > 0) {
      // Select the one with highest payout
      const selectedMarket = premiumMarkets.reduce((best, current) => 
        current.averagePayoutPercentage > best.averagePayoutPercentage ? current : best
      );
      
      return {
        success: true,
        selectedMarket,
        message: `Selected ${selectedMarket.displayName} with ${selectedMarket.averagePayoutPercentage.toFixed(2)}% payout`,
        selectionReason: `Priority 1: Highest payout (${selectedMarket.averagePayoutPercentage.toFixed(2)}%) meeting 95% minimum requirement`
      };
    }

    // Fallback: Select market with highest identical payout (even if below 95%)
    const selectedMarket = eligibleMarkets.reduce((best, current) => 
      current.averagePayoutPercentage > best.averagePayoutPercentage ? current : best
    );

    return {
      success: true,
      selectedMarket,
      message: `Selected ${selectedMarket.displayName} with ${selectedMarket.averagePayoutPercentage.toFixed(2)}% payout (fallback selection)`,
      selectionReason: `Fallback: Highest available identical payout (${selectedMarket.averagePayoutPercentage.toFixed(2)}%) - below 95% minimum`
    };
  }

  private getDisplayName(symbol: string): string {
    const displayNames: { [key: string]: string } = {
      'R_10': 'Volatility 10 Index',
      'R_25': 'Volatility 25 Index',
      'R_50': 'Volatility 50 Index',
      'R_75': 'Volatility 75 Index',
      'R_100': 'Volatility 100 Index',
      '1HZ10V': 'Volatility 10 (1s) Index',
      '1HZ25V': 'Volatility 25 (1s) Index',
      '1HZ50V': 'Volatility 50 (1s) Index',
      '1HZ75V': 'Volatility 75 (1s) Index',
      '1HZ100V': 'Volatility 100 (1s) Index',
      'BOOM300N': 'Boom 300 Index',
      'BOOM500N': 'Boom 500 Index',
      'BOOM1000N': 'Boom 1000 Index',
      'CRASH300N': 'Crash 300 Index',
      'CRASH500N': 'Crash 500 Index',
      'CRASH1000N': 'Crash 1000 Index',
      'RDBEAR': 'Bear Market Index',
      'RDBULL': 'Bull Market Index'
    };
    
    return displayNames[symbol] || symbol;
  }

  private getSubmarket(symbol: string): string {
    if (symbol.startsWith('R_') || symbol.includes('HZ')) return 'continuous_indices';
    if (symbol.includes('BOOM') || symbol.includes('CRASH')) return 'crash_boom';
    if (symbol.includes('BEAR') || symbol.includes('BULL')) return 'daily_reset_indices';
    return 'continuous_indices';
  }

  private getFromCache(key: string): MarketInfo | null {
    const expiry = this.cacheExpiry.get(key);
    if (!expiry || Date.now() > expiry) {
      this.marketCache.delete(key);
      this.cacheExpiry.delete(key);
      return null;
    }
    return this.marketCache.get(key) || null;
  }

  private setCache(key: string, data: MarketInfo): void {
    this.marketCache.set(key, data);
    this.cacheExpiry.set(key, Date.now() + this.CACHE_DURATION);
  }

  public clearCache(): void {
    this.marketCache.clear();
    this.cacheExpiry.clear();
    logger.info('Market selection cache cleared');
  }
}
