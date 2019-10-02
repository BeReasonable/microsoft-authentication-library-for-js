/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { Constants, TemporaryCacheKeys, PersistentCacheKeys } from "../utils/Constants";
import { AccessTokenCacheItem } from "./AccessTokenCacheItem";
import { CacheLocation } from "../Configuration";
import { BrowserStorage } from "./BrowserStorage";

/**
 * @hidden
 */
export class AuthCache extends BrowserStorage {// Singleton

    private clientId: string;
    private rollbackEnabled: boolean;

    constructor(clientId: string, cacheLocation: CacheLocation, storeAuthStateInCookie: boolean) {
        super(cacheLocation);
        this.clientId = clientId;
        // This is hardcoded to true for now. We may make this configurable in the future
        this.rollbackEnabled = true;
        this.migrateCacheEntries(storeAuthStateInCookie);
    }

    /**
     * Support roll back to old cache schema until the next major release: true by default now
     * @param storeAuthStateInCookie
     */
    private migrateCacheEntries(storeAuthStateInCookie: boolean) {

        const idTokenKey = `${Constants.cachePrefix}.${PersistentCacheKeys.IDTOKEN}`;
        const clientInfoKey = `${Constants.cachePrefix}.${PersistentCacheKeys.CLIENT_INFO}`;
        const errorKey = `${Constants.cachePrefix}.${PersistentCacheKeys.ERROR}`;
        const errorDescKey = `${Constants.cachePrefix}.${PersistentCacheKeys.ERROR_DESC}`;

        const idTokenValue = super.getItem(idTokenKey);
        const clientInfoValue = super.getItem(clientInfoKey);
        const errorValue = super.getItem(errorKey);
        const errorDescValue = super.getItem(errorDescKey);

        const values = [idTokenValue, clientInfoValue, errorValue, errorDescValue];
        const keysToMigrate = [PersistentCacheKeys.IDTOKEN, PersistentCacheKeys.CLIENT_INFO, PersistentCacheKeys.ERROR, PersistentCacheKeys.ERROR_DESC];

        keysToMigrate.forEach((cacheKey, index) => this.duplicateCacheEntry(cacheKey, values[index], storeAuthStateInCookie));
    }

    /**
     * Utility function to help with roll back keys
     * @param newKey
     * @param value
     * @param storeAuthStateInCookie
     */
    private duplicateCacheEntry(newKey: string, value: string, storeAuthStateInCookie?: boolean) {
        if (value) {
            this.setItem(newKey, value, storeAuthStateInCookie);
        }
    }

    /**
     * Prepend msal.<client-id> to each key; Skip for any JSON object as Key (defined schemas do not need the key appended: AccessToken Keys or the upcoming schema)
     * @param key
     * @param addInstanceId
     */
    private generateCacheKey(key: string, addInstanceId: boolean): string {
        try {
            JSON.parse(key);
            return key;
        } catch (e) {
            if (key.startsWith(`${Constants.cachePrefix}.${this.clientId}`)) {
                return key;
            } else {
                return addInstanceId ? `${Constants.cachePrefix}.${this.clientId}.${key}` : `${Constants.cachePrefix}.${key}`;
            }
        }
    }

    /**
     * add value to storage
     * @param key
     * @param value
     * @param enableCookieStorage
     */
    setItem(key: string, value: string, enableCookieStorage?: boolean): void {
        super.setItem(this.generateCacheKey(key, true), value, enableCookieStorage);

        if (this.rollbackEnabled) {
            super.setItem(this.generateCacheKey(key, false), value, enableCookieStorage);
        }
    }

    /**
     * get one item by key from storage
     * @param key
     * @param enableCookieStorage
     */
    getItem(key: string, enableCookieStorage?: boolean): string {
        return super.getItem(this.generateCacheKey(key, true), enableCookieStorage);
    }

    /**
     * remove value from storage
     * @param key
     */
    removeItem(key: string): void {
        super.removeItem(this.generateCacheKey(key, true));
        if (this.rollbackEnabled) {
            super.removeItem(this.generateCacheKey(key, false));
        }
    }

    /**
     * Reset the cache items
     */
    resetCacheItems(): void {
        const storage = window[this.cacheLocation];
        let key: string;
        this.removeAcquireTokenEntries();
        for (key in storage) {
            if (storage.hasOwnProperty(key)) {
                // Check if key contains msal prefix
                if (key.indexOf(Constants.cachePrefix) !== -1) {
                    // For now, we are clearing all cache items created by MSAL.js
                    super.removeItem(key);
                    // TODO: Clear cache based on client id (clarify use cases where this is needed)
                }
            }
        }
    }

    /**
     * Set cookies for IE
     * @param cName
     * @param cValue
     * @param expires
     */
    setItemCookie(cName: string, cValue: string, expires?: number): void {
        super.setItemCookie(this.generateCacheKey(cName, true), cValue, expires);
        if (this.rollbackEnabled) {
            super.setItemCookie(this.generateCacheKey(cName, false), cValue, expires);
        }
    }

    /**
     * get one item by key from cookies
     * @param cName
     */
    getItemCookie(cName: string): string {
        return super.getItemCookie(this.generateCacheKey(cName, true));
    }

    /**
     * Get all access tokens in the cache
     * @param clientId
     * @param homeAccountIdentifier
     */
    getAllAccessTokens(clientId: string, homeAccountIdentifier: string): Array<AccessTokenCacheItem> {
        const results = Object.keys(window[this.cacheLocation]).reduce((tokens, key) => {
            if ( window[this.cacheLocation].hasOwnProperty(key) && key.match(clientId) && key.match(homeAccountIdentifier)) {
                const value = this.getItem(key);
                if (value) {
                    const newAccessTokenCacheItem = new AccessTokenCacheItem(JSON.parse(key), JSON.parse(value));
                    return tokens.concat([ newAccessTokenCacheItem ]);
                }
            }

            return tokens;
        }, []);

        return results;
    }

    /**
     * Remove all temporary cache entries
     * @param state
     */
    removeAcquireTokenEntries(state?: string): void {
        const storage = window[this.cacheLocation];
        let key: string;
        for (key in storage) {
            if (storage.hasOwnProperty(key)) {
                if ((key.indexOf(TemporaryCacheKeys.AUTHORITY) !== -1 || key.indexOf(TemporaryCacheKeys.ACQUIRE_TOKEN_ACCOUNT) !== 1) && (!state || key.indexOf(state) !== -1)) {
                    const resourceDelimSplitKey = key.split(Constants.resourceDelimiter);
                    let keyState;
                    if (resourceDelimSplitKey.length > 1) {
                        keyState = resourceDelimSplitKey[resourceDelimSplitKey.length-1];
                    }
                    if (keyState && !this.tokenRenewalInProgress(keyState)) {
                        super.removeItem(key);
                        super.removeItem(TemporaryCacheKeys.RENEW_STATUS + state);
                        super.removeItem(TemporaryCacheKeys.STATE_LOGIN);
                        super.removeItem(TemporaryCacheKeys.STATE_ACQ_TOKEN);
                        super.removeItem(TemporaryCacheKeys.NONCE_IDTOKEN);
                        super.removeItem(TemporaryCacheKeys.LOGIN_REQUEST);
                        this.setItemCookie(key, "", -1);
                    }
                }
            }
        }

        this.clearMsalCookie();
    }

    /**
     * Return if the token renewal is still in progress
     * @param stateValue
     */
    private tokenRenewalInProgress(stateValue: string): boolean {
        const storage = window[this.cacheLocation];
        const renewStatus = storage[TemporaryCacheKeys.RENEW_STATUS + stateValue];
        return !(!renewStatus || renewStatus !== Constants.tokenRenewStatusInProgress);
    }

    /**
     * Clear all cookies
     */
    public clearMsalCookie(): void {
        this.clearItemCookie(TemporaryCacheKeys.NONCE_IDTOKEN);
        this.clearItemCookie(TemporaryCacheKeys.STATE_LOGIN);
        this.clearItemCookie(TemporaryCacheKeys.LOGIN_REQUEST);
        this.clearItemCookie(TemporaryCacheKeys.STATE_ACQ_TOKEN);
    }

    /**
     * Create acquireTokenAccountKey to cache account object
     * @param accountId
     * @param state
     */
    public static generateAcquireTokenAccountKey(accountId: any, state: string): string {
        return TemporaryCacheKeys.ACQUIRE_TOKEN_ACCOUNT + Constants.resourceDelimiter +
            `${accountId}` + Constants.resourceDelimiter  + `${state}`;
    }

    /**
     * Create authorityKey to cache authority
     * @param state
     */
    public static generateAuthorityKey(state: string): string {
        return TemporaryCacheKeys.AUTHORITY + Constants.resourceDelimiter + `${state}`;
    }
}