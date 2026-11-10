// P929: is the signed-in user a test account (profiles.is_test)? Test accounts always see sample info with no sample label.
import { useOptionalAuth } from './authContext'
import { isTestProfile } from '../lib/testAccounts'

export const useIsTestAccount = () => isTestProfile(useOptionalAuth()?.profile)
