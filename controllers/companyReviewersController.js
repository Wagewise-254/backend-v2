import supabase from "../libs/supabaseAdmin.js";
import { checkCompanyAccess } from "./employeeController.js";

// List all reviewers for a company
export const listCompanyReviewers = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  // Check authorization - need read access to org settings
  const isAuthorized = await checkCompanyAccess(
    companyId,
    userId,
    "ORG_SETTINGS",
    "can_read"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to view company reviewers.",
    });
  }

  try {
    // First, get all reviewers with company user details
    const { data: reviewers, error } = await supabase
      .from("company_reviewers")
      .select(`
        id,
        reviewer_level,
        created_at,
        company_id,
        company_user_id,
        company_users (
          id,
          user_id,
          role,
          created_at
        )
      `)
      .eq("company_id", companyId)
      .order("reviewer_level", { ascending: true });

    if (error) throw error;

    // Then fetch user details from auth.users for each reviewer
    const formattedReviewers = await Promise.all(
      reviewers.map(async (reviewer) => {
        try {
          // Get user details from auth.users using admin API
          const { data: userData, error: userError } = await supabase.auth.admin.getUserById(
            reviewer.company_users.user_id
          );

          if (userError) throw userError;

          return {
            id: reviewer.id,
            reviewer_level: reviewer.reviewer_level,
            created_at: reviewer.created_at,
            company_user_id: reviewer.company_user_id,
            user_id: reviewer.company_users.user_id,
            email: userData.user?.email,
            full_names: userData.user?.user_metadata?.full_names || 
                        userData.user?.user_metadata?.user_name,
            role: reviewer.company_users.role,
            status: userData.user?.banned_until ? 'SUSPENDED' : 'ACTIVE',
            last_sign_in: userData.user?.last_sign_in_at,
          };
        } catch (error) {
          console.error(`Error fetching user ${reviewer.company_users.user_id}:`, error);
          return {
            id: reviewer.id,
            reviewer_level: reviewer.reviewer_level,
            created_at: reviewer.created_at,
            company_user_id: reviewer.company_user_id,
            user_id: reviewer.company_users.user_id,
            email: null,
            full_names: null,
            role: reviewer.company_users.role,
            status: 'UNKNOWN',
            last_sign_in: null,
          };
        }
      })
    );

    res.json(formattedReviewers);
  } catch (error) {
    console.error("Error listing company reviewers:", error);
    res.status(500).json({ error: "Failed to fetch company reviewers" });
  }
};

// Get eligible users to become reviewers (ADMINs and MANAGERs not already reviewers)
export const getEligibleReviewers = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  // Check authorization
  const isAuthorized = await checkCompanyAccess(
    companyId,
    userId,
    "ORG_SETTINGS",
    "can_read"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to view eligible reviewers.",
    });
  }

  try {
    // Get all ADMIN and MANAGER company users
    const { data: companyUsers, error: usersError } = await supabase
      .from("company_users")
      .select(`
        id,
        user_id,
        role
      `)
      .eq("company_id", companyId)
      .in("role", ["ADMIN", "MANAGER"]);

    if (usersError) throw usersError;

    // Get existing reviewers to exclude them
    const { data: existingReviewers, error: reviewersError } = await supabase
      .from("company_reviewers")
      .select("company_user_id")
      .eq("company_id", companyId);

    if (reviewersError) throw reviewersError;

    const existingReviewerIds = existingReviewers.map(r => r.company_user_id);

    // Filter out users who are already reviewers
    const eligibleUsers = await Promise.all(
      companyUsers
        .filter(cu => !existingReviewerIds.includes(cu.id))
        .map(async (cu) => {
          try {
            const { data: userData, error: userError } = await supabase.auth.admin.getUserById(cu.user_id);
            
            if (userError) throw userError;

            return {
              company_user_id: cu.id,
              user_id: cu.user_id,
              email: userData.user?.email,
              full_names: userData.user?.user_metadata?.full_names || 
                          userData.user?.user_metadata?.user_name,
              role: cu.role,
              status: userData.user?.banned_until ? 'SUSPENDED' : 'ACTIVE',
            };
          } catch (error) {
            return null;
          }
        })
    );

    // Filter out null values and only show active users
    const filteredEligibleUsers = eligibleUsers
      .filter((user) => user !== null)
      .filter(user => user.status === 'ACTIVE');

    res.json(filteredEligibleUsers);
  } catch (error) {
    console.error("Error fetching eligible reviewers:", error);
    res.status(500).json({ error: "Failed to fetch eligible reviewers" });
  }
};

// Add a reviewer
export const addCompanyReviewer = async (req, res) => {
  const { companyId } = req.params;
  const { company_user_id, reviewer_level } = req.body;
  const userId = req.userId;

  // Validate required fields
  if (!company_user_id) {
    return res.status(400).json({ 
      error: "Company user ID is required" 
    });
  }

  if (!reviewer_level || reviewer_level < 1) {
    return res.status(400).json({ 
      error: "Reviewer level must be at least 1" 
    });
  }

  // Check authorization - need write access to org settings
  const isAuthorized = await checkCompanyAccess(
    companyId,
    userId,
    "ORG_SETTINGS",
    "can_write"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to add company reviewers.",
    });
  }

  try {
    // Verify the company user exists and belongs to this company
    const { data: companyUser, error: userError } = await supabase
      .from("company_users")
      .select("id, user_id, role, company_id")
      .eq("id", company_user_id)
      .eq("company_id", companyId)
      .single();

    if (userError || !companyUser) {
      return res.status(404).json({ error: "Company user not found" });
    }

    // Verify the user has appropriate role (ADMIN or MANAGER)
    if (!["ADMIN", "MANAGER"].includes(companyUser.role)) {
      return res.status(400).json({ 
        error: "Only ADMIN and MANAGER users can be reviewers" 
      });
    }

    // Check if user is already a reviewer
    const { data: existingReviewer } = await supabase
      .from("company_reviewers")
      .select("id")
      .eq("company_id", companyId)
      .eq("company_user_id", company_user_id)
      .maybeSingle();

    if (existingReviewer) {
      return res.status(400).json({ 
        error: "User is already a reviewer for this company" 
      });
    }

    // Check if reviewer level already exists
    const { data: existingLevel } = await supabase
      .from("company_reviewers")
      .select("id")
      .eq("company_id", companyId)
      .eq("reviewer_level", reviewer_level)
      .maybeSingle();

    if (existingLevel) {
      // Auto-adjust levels - shift higher levels up
      await supabase
        .from("company_reviewers")
        .update({ reviewer_level: supabase.raw('reviewer_level + 1') })
        .eq("company_id", companyId)
        .gte("reviewer_level", reviewer_level);
    }

    // Add reviewer
    const { data: reviewer, error } = await supabase
      .from("company_reviewers")
      .insert([{
        company_id: companyId,
        company_user_id,
        reviewer_level,
      }])
      .select(`
        id,
        reviewer_level,
        created_at,
        company_user_id,
        company_users (
          role,
          user_id
        )
      `)
      .single();

    if (error) throw error;

    // Get user details from auth
    const { data: userData } = await supabase.auth.admin.getUserById(companyUser.user_id);

    // Format response
    const formattedReviewer = {
      id: reviewer.id,
      reviewer_level: reviewer.reviewer_level,
      created_at: reviewer.created_at,
      company_user_id: reviewer.company_user_id,
      user_id: reviewer.company_users.user_id,
      email: userData.user?.email,
      full_names: userData.user?.user_metadata?.full_names ||
                  userData.user?.user_metadata?.user_name,
      role: reviewer.company_users.role,
    };

    // Create audit log entry
    await supabase.from("audit_logs").insert({
      entity_type: "company_reviewer",
      entity_id: reviewer.id,
      action: "CREATE",
      performed_by: userId,
      new_data: formattedReviewer,
    });

    res.status(201).json({
      success: true,
      reviewer: formattedReviewer,
    });
  } catch (error) {
    console.error("Error adding company reviewer:", error);
    res.status(500).json({ error: "Failed to add company reviewer" });
  }
};

// Update reviewer level
export const updateReviewerLevel = async (req, res) => {
  const { companyId, reviewerId } = req.params;
  const { reviewer_level } = req.body;
  const userId = req.userId;

  if (!reviewer_level || reviewer_level < 1) {
    return res.status(400).json({ 
      error: "Reviewer level must be at least 1" 
    });
  }

  // Check authorization - need approve access for role changes
  const isAuthorized = await checkCompanyAccess(
    companyId,
    userId,
    "ORG_SETTINGS",
    "can_approve"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to update reviewer levels.",
    });
  }

  try {
    // Get current reviewer with company user details
    const { data: currentReviewer, error: fetchError } = await supabase
      .from("company_reviewers")
      .select(`
        reviewer_level,
        company_user_id,
        company_users (
          user_id,
          role
        )
      `)
      .eq("id", reviewerId)
      .eq("company_id", companyId)
      .single();

    if (fetchError) {
      return res.status(404).json({ error: "Reviewer not found" });
    }

    // If level is changing
    if (currentReviewer.reviewer_level !== reviewer_level) {
      // Handle level conflicts - shift other reviewers
      if (reviewer_level < currentReviewer.reviewer_level) {
        // Moving up (lower number) - shift others down
        await supabase
          .from("company_reviewers")
          .update({ reviewer_level: supabase.raw('reviewer_level + 1') })
          .eq("company_id", companyId)
          .gte("reviewer_level", reviewer_level)
          .lt("reviewer_level", currentReviewer.reviewer_level);
      } else {
        // Moving down (higher number) - shift others up
        await supabase
          .from("company_reviewers")
          .update({ reviewer_level: supabase.raw('reviewer_level - 1') })
          .eq("company_id", companyId)
          .gt("reviewer_level", currentReviewer.reviewer_level)
          .lte("reviewer_level", reviewer_level);
      }
    }

    // Update reviewer level
    const { data: reviewer, error } = await supabase
      .from("company_reviewers")
      .update({ reviewer_level })
      .eq("id", reviewerId)
      .eq("company_id", companyId)
      .select(`
        id,
        reviewer_level,
        company_user_id,
        company_users (
          role,
          user_id
        )
      `)
      .single();

    if (error) throw error;

    // Get user details from auth
    const { data: userData } = await supabase.auth.admin.getUserById(currentReviewer.company_users.user_id);

    const formattedReviewer = {
      id: reviewer.id,
      reviewer_level: reviewer.reviewer_level,
      company_user_id: reviewer.company_user_id,
      user_id: reviewer.company_users.user_id,
      email: userData.user?.email,
      full_names: userData.user?.user_metadata?.full_names,
      role: reviewer.company_users.role,
    };

    // Audit log
    await supabase.from("audit_logs").insert({
      entity_type: "company_reviewer",
      entity_id: reviewer.id,
      action: "UPDATE",
      performed_by: userId,
      new_data: formattedReviewer,
    });

    res.json({
      success: true,
      reviewer: formattedReviewer,
    });
  } catch (error) {
    console.error("Error updating reviewer level:", error);
    res.status(500).json({ error: "Failed to update reviewer level" });
  }
};

// Remove a reviewer
export const removeCompanyReviewer = async (req, res) => {
  const { companyId, reviewerId } = req.params;
  const userId = req.userId;

  // Check authorization - need delete access
  const isAuthorized = await checkCompanyAccess(
    companyId,
    userId,
    "ORG_SETTINGS",
    "can_delete"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to remove company reviewers.",
    });
  }

  try {
    // Get reviewer details for audit log
    const { data: reviewer, error: fetchError } = await supabase
      .from("company_reviewers")
      .select(`
        id,
        reviewer_level,
        company_user_id,
        company_users (
          user_id
        )
      `)
      .eq("id", reviewerId)
      .eq("company_id", companyId)
      .single();

    if (fetchError) {
      return res.status(404).json({ error: "Reviewer not found" });
    }

    // Delete reviewer
    const { error } = await supabase
      .from("company_reviewers")
      .delete()
      .eq("id", reviewerId)
      .eq("company_id", companyId);

    if (error) throw error;

    // Reorder remaining reviewers to fill the gap
    await supabase
      .from("company_reviewers")
      .update({ reviewer_level: supabase.raw('reviewer_level - 1') })
      .eq("company_id", companyId)
      .gt("reviewer_level", reviewer.reviewer_level);

    // Audit log
    await supabase.from("audit_logs").insert({
      entity_type: "company_reviewer",
      entity_id: reviewerId,
      action: "DELETE",
      performed_by: userId,
      old_data: reviewer,
    });

    res.json({ 
      success: true,
      message: "Reviewer removed successfully" 
    });
  } catch (error) {
    console.error("Error removing company reviewer:", error);
    res.status(500).json({ error: "Failed to remove company reviewer" });
  }
};

// Reorder reviewers (bulk update)
export const reorderReviewers = async (req, res) => {
  const { companyId } = req.params;
  const { reviewers } = req.body; // Array of { id, reviewer_level }
  const userId = req.userId;

  if (!Array.isArray(reviewers) || reviewers.length === 0) {
    return res.status(400).json({ error: "Reviewers array is required" });
  }

  // Check authorization
  const isAuthorized = await checkCompanyAccess(
    companyId,
    userId,
    "ORG_SETTINGS",
    "can_approve"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to reorder reviewers.",
    });
  }

  try {
    // Update each reviewer's level
    const updates = reviewers.map(({ id, reviewer_level }) => 
      supabase
        .from("company_reviewers")
        .update({ reviewer_level })
        .eq("id", id)
        .eq("company_id", companyId)
    );

    await Promise.all(updates);

    // Audit log
    await supabase.from("audit_logs").insert({
      entity_type: "company_reviewer",
      entity_id: companyId,
      action: "UPDATE",
      performed_by: userId,
      new_data: { reordered: reviewers },
    });

    res.json({ 
      success: true,
      message: "Reviewers reordered successfully" 
    });
  } catch (error) {
    console.error("Error reordering reviewers:", error);
    res.status(500).json({ error: "Failed to reorder reviewers" });
  }
};