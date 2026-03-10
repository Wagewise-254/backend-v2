import supabase from '../libs/supabaseClient.js';

export const cleanupExpiredCodes = async () => {
  try {
    const { error } = await supabase
      .from('password_recovery_codes')
      .delete()
      .or(`expires_at.lt.${new Date().toISOString()},used.eq.true`);

    if (error) {
      console.error('Error cleaning up expired codes:', error);
    } else {
      console.log('Successfully cleaned up expired recovery codes');
    }
  } catch (error) {
    console.error('Cleanup job error:', error);
  }
};