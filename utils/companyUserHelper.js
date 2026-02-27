// utils/companyUserHelper.js
import supabase from "../libs/supabaseClient.js";

export const getCurrentCompanyUser = async (userId, companyId) => {
  const { data: companyUser, error } = await supabase
    .from("company_users")
    .select("id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .single();

  if (error || !companyUser) {
    throw new Error("Could not find company user record");
  }

  return companyUser;
};