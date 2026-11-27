import {describe,it,expect} from 'vitest'
import {MarketReviewSchema,reviewMarket} from './fss-market-review.js'
// Synthetic market rows; no redistributed KRX feed data.
const raw=[['20261016',100,410000],['20261109',100,380000],['20261113',100,391050]] as const
const rows=raw.map(([date,v,t])=>({date,symbol:'363250',market:'KOSDAQ' as const,volume:String(v),trading_value:String(t)}))
const p=MarketReviewSchema.parse({mode:'market_review',instrument:'CB',symbol:'363250',market:'KOSDAQ',board_date:'20261116',month_start:'20261016',week_start:'20261109',expected_sessions:rows.map(r=>r.date),rows,reported_price:3911,offering:'third_party_under_month'})
describe('source bounded KRX VWAP',()=>{
 it('reconciles synthetic session data exact sums',()=>{const r=reviewMarket(p);expect(r).toMatchObject({sessionCount:3,recentSession:'20261113',minimumWholeKrw:'3911',status:'AT_OR_ABOVE_STANDARD_PRICE',calendarVerified:false,complianceDetermined:false});expect(r).toMatchObject({recent:{numerator:'391050',denominator:'100'}})})
 it('rejects duplicate or wrong symbol',()=>{expect(()=>reviewMarket({...p,rows:[...rows,rows[0]]})).toThrow();expect(()=>reviewMarket({...p,rows:[{...rows[0],symbol:'000000'},...rows.slice(1)]})).toThrow()})
 it('blocks incomplete declared dates',()=>expect(reviewMarket({...p,rows:rows.slice(1)})).toMatchObject({status:'INCOMPLETE_SESSION_COVERAGE',missing:['20261016']}))
 it('requires third session where applicable',()=>expect(reviewMarket({...p,offering:'third_party_at_least_month'}).status).toBe('THIRD_SESSION_REQUIRED'))
 it('blocks EB mapping',()=>expect(reviewMarket({...p,instrument:'EB'}).status).toBe('NOT_MAPPED_FOR_EB'))
 it('does not use zero volume last session',()=>expect(reviewMarket({...p,rows:[...rows.slice(0,-1),{...rows.at(-1)!,volume:'0',trading_value:'0'}]}).status).toBe('NO_POSITIVE_VOLUME_IN_REQUIRED_WINDOW'))
})
