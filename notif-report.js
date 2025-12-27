// ============ SUPABASE CLIENT ==============
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let supabase = null;

// Initialize Supabase client
try {
    const supabaseUrl = 'https://gwvepxupoxyyydnisulb.supabase.co';
    const supabaseKey = 'sb_publishable_4baWNqraxymp0Gal3OKhxQ_Bl-IHHdt';

    // Check if URL and key are valid
    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase URL or key is missing');
    }

    // Initialize Supabase client
    supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Supabase client initialized successfully");

} catch (error) {
    console.error("Failed to initialize Supabase:", error);
    throw new Error(`Supabase initialization failed: ${error.message}`);
}

// ======================================================
// ===== SAVE REPORT (SUPABASE UPLOAD + DATABASE) ======
// ======================================================
export async function saveReportToSupabase(report, base64Image) {
  console.log("Starting saveReportToSupabase with:", report);
  
  // Check if Supabase is initialized
  if (!supabase) {
    throw new Error("Supabase client not initialized. Please refresh the page.");
  }
  
  let imageURL = null;

  // 1. Upload image to storage if exists
  if (base64Image) {
    try {
      console.log("Processing image...");
      const fileName = `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
      
      // Convert base64 to blob
      let imageBlob;
      try {
        if (base64Image.startsWith('data:')) {
          // If it's already a data URL
          const base64Response = await fetch(base64Image);
          imageBlob = await base64Response.blob();
        } else {
          // If it's raw base64
          const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          imageBlob = new Blob([byteArray], { type: 'image/jpeg' });
        }
      } catch (blobError) {
        console.error("Error converting to blob:", blobError);
        // Try alternative method
        imageBlob = base64ToBlob(base64Image);
      }
      
      console.log("Uploading to bucket: aid-upload");

      // Upload to storage bucket
      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from("aid-upload")
        .upload(fileName, imageBlob, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'image/jpeg'
        });

      if (uploadError) {
        console.error("Supabase Upload Error:", uploadError);
        
        // Provide helpful error messages
        if (uploadError.message && uploadError.message.includes('Bucket not found')) {
          throw new Error(`Bucket 'aid-upload' not found. Please create the bucket in Supabase Storage.`);
        }
        
        if (uploadError.message && uploadError.message.includes('row-level security policy')) {
          throw new Error("Storage RLS policy blocking upload. Check storage policies in Supabase.");
        }
        
        throw uploadError;
      }

      console.log("Upload successful:", uploadData);

      // Get public URL
      const { data: publicUrlData } = supabase
        .storage
        .from("aid-upload")
        .getPublicUrl(fileName);

      imageURL = publicUrlData.publicUrl;
      console.log("Image URL:", imageURL);
      
    } catch (imageError) {
      console.error("Image upload failed:", imageError);
      // Continue without image
      console.log("Continuing without image...");
    }
  }

  // 2. Insert report into database
  try {
    console.log("Inserting into database...");
    
    // Ensure latitude and longitude are numbers
    const latitude = parseFloat(report.latitude) || 0;
    const longitude = parseFloat(report.longitude) || 0;
    
    const reportData = {
      type: report.type || 'emergency',
      type_display: report.type_display || 'Emergency',
      reporter: report.reporter || 'Anonymous',
      latitude: latitude,
      longitude: longitude,
      timestamp: report.timestamp || new Date().toISOString(),
      photo_url: imageURL,
      created_at: new Date().toISOString(),
      status: report.status || 'pending',
      updated_at: new Date().toISOString()
    };
    
    console.log("Report data to insert:", reportData);

    const { data, error: insertError } = await supabase
      .from('reports')
      .insert([reportData])
      .select();

    if (insertError) {
      console.error("Supabase Insert Error:", insertError);
      console.error("Error details:", insertError.details, insertError.hint, insertError.code);
      
      if (insertError.code === 'PGRST204' || insertError.message?.includes('Could not find')) {
        throw new Error(`Database table 'reports' not found. Please create the table first.`);
      }
      
      if (insertError.message?.includes('violates check constraint')) {
        throw new Error(`Invalid status value. Status must be one of: pending, investigating, resolved, cancelled`);
      }
      
      throw insertError;
    }

    console.log("Report saved successfully with status:", reportData.status);
    console.log("Saved data:", data);
    return { success: true, data };
    
  } catch (dbError) {
    console.error("Database operation failed:", dbError);
    throw dbError;
  }
}

// ======================================================
// ===== NOTIFICATION FUNCTIONS ======
// ======================================================

// Get unread notification count for user
export async function getUnreadNotificationCount(userName) {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    // Get last notification check time from localStorage
    const lastCheck = localStorage.getItem(`lastNotificationCheck_${userName}`);
    const lastCheckTime = lastCheck ? new Date(lastCheck) : new Date(0);
    
    // Get user's reports from the last 24 hours
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const { data: reports, error } = await supabase
      .from('reports')
      .select('id, reporter, status, assigned_responders, created_at, updated_at')
      .or(`reporter.eq.${userName},reporter.ilike.%${userName}%`)
      .gt('created_at', yesterday.toISOString())
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Filter for unread notifications (updated after last check)
    let unreadCount = 0;
    const unreadReports = [];
    
    reports.forEach(report => {
      const reportUpdated = new Date(report.updated_at || report.created_at);
      const isUnread = reportUpdated > lastCheckTime;
      
      if (isUnread) {
        // Check for important updates
        const hasResponders = report.assigned_responders && report.assigned_responders.trim() !== '';
        const hasStatusUpdate = report.status === 'investigating' || report.status === 'resolved';
        
        if (hasResponders || hasStatusUpdate) {
          unreadCount++;
          unreadReports.push(report);
        }
      }
    });
    
    return { count: unreadCount, reports: unreadReports };
  } catch (error) {
    console.error('Error getting unread notifications:', error);
    return { count: 0, reports: [], error: error.message };
  }
}

// Mark notifications as read for user
export function markNotificationsAsRead(userName) {
  try {
    // Store current time as last check time
    localStorage.setItem(`lastNotificationCheck_${userName}`, new Date().toISOString());
    
    // Also clear the notification count in localStorage
    localStorage.setItem('notificationCount', '0');
    
    return { success: true, message: "Notifications marked as read" };
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    return { success: false, error: error.message };
  }
}

// ======================================================
// ===== ADDITIONAL HELPER FUNCTIONS ======
// ======================================================

// Helper function to convert base64 to blob
export function base64ToBlob(base64) {
  try {
    // Remove data URL prefix if present
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    const byteString = atob(base64Data);
    const mimeString = base64.includes(',') ? 
      base64.split(',')[0].split(':')[1].split(';')[0] : 
      'image/jpeg';
    
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    
    return new Blob([ab], { type: mimeString });
  } catch (error) {
    console.error("Error converting base64 to blob:", error);
    throw error;
  }
}

// Get all reports (for admin dashboard)
export async function getAllReports() {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching reports:', error);
    throw error;
  }
}

// Update report status
export async function updateReportStatus(reportId, newStatus) {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    const validStatuses = ['pending', 'investigating', 'resolved', 'cancelled'];
    
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const { data, error } = await supabase
      .from('reports')
      .update({ 
        status: newStatus,
        updated_at: new Date().toISOString() 
      })
      .eq('id', reportId)
      .select();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating report status:', error);
    throw error;
  }
}

// Test Supabase connection
export async function testSupabaseConnection() {
  try {
    if (!supabase) {
      return { connected: false, error: "Supabase client not initialized" };
    }
    
    // Simple test query
    const { data, error } = await supabase
      .from('reports')
      .select('count')
      .limit(1);
    
    if (error && error.code !== '42P01') { // Ignore "relation does not exist" error
      return { connected: false, error: error.message };
    }
    
    return { connected: true, data };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

// Get report count by status
export async function getReportCounts() {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    const { data, error } = await supabase
      .from('reports')
      .select('status');

    if (error) throw error;
    
    const counts = {
      pending: 0,
      investigating: 0,
      resolved: 0,
      cancelled: 0,
      total: data?.length || 0
    };
    
    data?.forEach(report => {
      if (counts.hasOwnProperty(report.status)) {
        counts[report.status]++;
      }
    });
    
    return counts;
  } catch (error) {
    console.error('Error getting report counts:', error);
    throw error;
  }
}

// Search reports by reporter name or type
export async function searchReports(searchTerm) {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .or(`reporter.ilike.%${searchTerm}%,type.ilike.%${searchTerm}%,type_display.ilike.%${searchTerm}%`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error searching reports:', error);
    throw error;
  }
}

// Delete report (admin only)
export async function deleteReport(reportId) {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    const { data, error } = await supabase
      .from('reports')
      .delete()
      .eq('id', reportId)
      .select();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error deleting report:', error);
    throw error;
  }
}

// Get reports by status
export async function getReportsByStatus(status) {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching reports by status:', error);
    throw error;
  }
}

// Export supabase instance for direct use if needed
export { supabase };