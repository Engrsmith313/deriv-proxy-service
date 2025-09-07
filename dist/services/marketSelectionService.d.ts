import { DerivApiService } from './derivApi';
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
export declare class MarketSelectionService {
    private derivApi;
    private marketCache;
    private cacheExpiry;
    private readonly CACHE_DURATION;
    private readonly CONTINUOUS_INDICES_SYMBOLS;
    constructor(derivApi: DerivApiService);
    selectOptimalMarket(amount: number, duration: number, durationUnit?: string): Promise<MarketSelectionResult>;
    private getMarketData;
    private getProposal;
    private createMarketInfo;
    private calculatePayoutPercentage;
    private applyMarketSelectionAlgorithm;
    private getDisplayName;
    private getSubmarket;
    private getFromCache;
    private setCache;
    clearCache(): void;
}
//# sourceMappingURL=marketSelectionService.d.ts.map