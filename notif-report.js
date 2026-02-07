// ============ SUPABASE CLIENT ==============
// Using the new import method for ES modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

let supabase = null;

// Initialize Supabase client
try {
    const supabaseUrl = 'https://gwvepxupoxyyydnisulb.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3dmVweHVwb3h5eXlkbmlzdWxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MDE4ODcsImV4cCI6MjA4MDM3Nzg4N30.Ku9SXTAKNMvHilgEpxj5HcVA-0TPt4ziuEq0Irao5Qc';

    // Check if URL and key are valid
    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase URL or key is missing');
    }

    // Initialize Supabase client
    supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: false
        }
    });

    console.log("Supabase client initialized successfully");

} catch (error) {
    console.error("Failed to initialize Supabase:", error);
    // Create a mock supabase object to prevent crashes
    supabase = {
        storage: {
            from: () => ({
                upload: () => Promise.resolve({ data: null, error: null }),
                getPublicUrl: () => ({ data: { publicUrl: null } })
            })
        },
        from: () => ({
            insert: () => Promise.resolve({ data: null, error: null }),
            select: () => Promise.resolve({ data: null, error: null }),
            update: () => Promise.resolve({ data: null, error: null }),
            delete: () => Promise.resolve({ data: null, error: null }),
            eq: () => ({
                select: () => Promise.resolve({ data: null, error: null }),
                update: () => Promise.resolve({ data: null, error: null }),
                delete: () => Promise.resolve({ data: null, error: null })
            })
        }),
        rpc: () => Promise.resolve({ data: null, error: null })
    };
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
  if (base64Image && base64Image.trim() !== '') {
    try {
      console.log("Processing image...");
      
      // Convert base64 to blob
      let imageBlob;
      let contentType = 'image/jpeg';

        // Handle data URL format to get content type and base64 data
        let base64Data;
        if (base64Image.includes(',')) {
          const parts = base64Image.split(',');
          const mimeMatch = parts[0].match(/data:([^;]+)/);
          if (mimeMatch) {
            contentType = mimeMatch[1];
          }
          base64Data = parts[1];
        } else {
          base64Data = base64Image;
        }

        // Ensure content type is a valid image type
        if (!contentType.startsWith('image/')) {
          contentType = 'image/jpeg';
        }

      // Generate unique filename with proper extension based on content type
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 15);
      let extension = 'jpg';
      if (contentType.includes('png')) extension = 'png';
      else if (contentType.includes('gif')) extension = 'gif';
      else if (contentType.includes('webp')) extension = 'webp';
      const fileName = `report-${timestamp}-${randomStr}.${extension}`;

      try {

        // Clean the base64 data - remove any whitespace
        base64Data = base64Data.replace(/\s/g, '');

        // Validate base64 format
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)) {
          throw new Error("Invalid base64 data format");
        }

        // Decode base64
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);

        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        imageBlob = new Blob([byteArray], { type: contentType });

        console.log(`Image blob created: ${imageBlob.size} bytes, type: ${contentType}`);

        // Validate blob size (should be reasonable for an image)
        if (imageBlob.size > 10 * 1024 * 1024) { // 10MB limit
          throw new Error("Image file is too large. Please use a smaller image.");
        }

        if (imageBlob.size < 1000) { // Less than 1KB is suspicious
          throw new Error("Image data appears to be corrupted. Please try again.");
        }

        // Additional validation: check if it looks like image data
        const firstBytes = byteArray.slice(0, 4);
        const isValidImage = (
          // JPEG: FF D8 FF
          (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8 && firstBytes[2] === 0xFF) ||
          // PNG: 89 50 4E 47
          (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) ||
          // GIF: 47 49 46
          (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46) ||
          // WebP: 52 49 46 46
          (firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46)
        );

        if (!isValidImage) {
          console.warn("Blob doesn't appear to be a valid image format, but proceeding anyway");
        }

      } catch (blobError) {
        console.error("Error converting base64 to blob:", blobError);
        throw new Error("Failed to process image. Please try again with a different image.");
      }
      
      console.log("Uploading to bucket: aid-upload");

      // Upload to storage bucket
      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from("aid-upload")
        .upload(fileName, imageBlob, {
          cacheControl: '3600',
          upsert: false,
          contentType: contentType
        });

      if (uploadError) {
        console.error("Supabase Upload Error:", uploadError);
        
        // Provide helpful error messages
        if (uploadError.message && uploadError.message.includes('Bucket not found')) {
          throw new Error(`Storage bucket 'aid-upload' not found. Please create the bucket in Supabase Storage.`);
        }
        
        if (uploadError.message && uploadError.message.includes('row-level security policy')) {
          throw new Error("Storage permission denied. Please check storage RLS policies in Supabase.");
        }
        
        if (uploadError.message && uploadError.message.includes('already exists')) {
          // Try with different filename
          const newFileName = `report-${Date.now()}-${Math.random().toString(36).substring(2, 15)}.jpg`;
          const retryUpload = await supabase
            .storage
            .from("aid-upload")
            .upload(newFileName, imageBlob, {
              cacheControl: '3600',
              upsert: false,
              contentType: 'image/jpeg'
            });
            
          if (retryUpload.error) throw retryUpload.error;
          uploadData = retryUpload.data;
        } else {
          throw uploadError;
        }
      }

      console.log("Upload successful:", uploadData);

      // Get public URL
      const { data: publicUrlData } = supabase
        .storage
        .from("aid-upload")
        .getPublicUrl(uploadData?.path || fileName);

      imageURL = publicUrlData.publicUrl;
      console.log("Image URL generated:", imageURL);
      
    } catch (imageError) {
      console.error("Image upload failed:", imageError);
      // Continue without image but warn the user
      console.log("Continuing without image due to upload error...");
      // You could show a toast notification here
    }
  }

  // 2. Insert report into database
  try {
    console.log("Inserting report into database...");
    
    // Ensure latitude and longitude are valid numbers
    const latitude = !isNaN(parseFloat(report.latitude)) ? parseFloat(report.latitude) : 0;
    const longitude = !isNaN(parseFloat(report.longitude)) ? parseFloat(report.longitude) : 0;
    
    // Get reporter name from report or localStorage
    let reporterName = report.reporter || 'Anonymous';
    if (!reporterName || reporterName === 'Anonymous') {
      const accountData = localStorage.getItem('accountData');
      if (accountData) {
        try {
          const parsed = JSON.parse(accountData);
          reporterName = parsed.fullName || 'Anonymous';
        } catch (e) {
          reporterName = 'Anonymous';
        }
      }
      // Don't fall back to old reporterName - only use account data or Anonymous
    }
    
    // Check if in guest mode
    const isGuestMode = localStorage.getItem('isGuestMode') === 'true';
    if (isGuestMode) {
      // Use persistent unique guest ID for privacy
      const guestId = localStorage.getItem('guestId') || `guest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('guestId', guestId);
      reporterName = guestId; // Use unique ID for database queries
    }

    const reportData = {
      type: report.type || 'emergency',
      type_display: report.type_display || 'Emergency',
      reporter: reporterName,
      latitude: latitude,
      longitude: longitude,
      photo_url: imageURL,
      timestamp: report.timestamp || new Date().toISOString(),
      created_at: new Date().toISOString(),
      status: report.status || 'pending',
      updated_at: new Date().toISOString(),
      is_guest: false
    };

    console.log("Report data to insert:", reportData);

    // Insert the report
    const { data: insertedData, error: insertError } = await supabase
      .from('reports')
      .insert([reportData])
      .select()
      .single();  // Get single record back

    if (insertError) {
      console.error("Supabase Insert Error:", insertError);
      console.error("Error details:", {
        code: insertError.code,
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint
      });

      // Helpful error messages based on common issues
      if (insertError.code === '42P01' || insertError.message?.includes('relation "reports" does not exist')) {
        throw new Error(`Database table 'reports' not found. Please create the table in Supabase.`);
      }

      if (insertError.message?.includes('violates row-level security policy')) {
        throw new Error("Permission denied. Please check RLS policies for the 'reports' table.");
      }

      if (insertError.message?.includes('violates check constraint')) {
        throw new Error(`Invalid status value. Status must be one of: pending, investigating, resolved, cancelled`);
      }

      if (insertError.message?.includes('null value in column')) {
        throw new Error(`Missing required field: ${insertError.message.match(/column "(\w+)"/)?.[1] || 'unknown'}`);
      }

      throw new Error(`Database error: ${insertError.message}`);
    }

    console.log("Report saved successfully with status:", reportData.status);
    console.log("Saved data:", insertedData);

    return {
      success: true,
      data: insertedData,
      reportId: insertedData?.id,
      message: "Emergency report submitted successfully!"
    };
    
  } catch (dbError) {
    console.error("Database operation failed:", dbError);
    
    // If we have a more specific error message, use it
    if (dbError.message) {
      throw dbError;
    }
    
    throw new Error(`Failed to save report: ${dbError.message || 'Unknown database error'}`);
  }
}

// ======================================================
// ===== NOTIFICATION FUNCTIONS ======
// ======================================================

// Get unread notification count for user
export async function getUnreadNotificationCount(userName) {
  try {
    if (!supabase) {
      console.warn("Supabase not initialized");
      return { count: 0, reports: [], error: "Supabase not initialized" };
    }
    
    if (!userName || userName.trim() === '') {
      return { count: 0, reports: [] };
    }
    
    // Get last notification check time from localStorage
    const lastCheck = localStorage.getItem(`lastNotificationCheck_${userName}`);
    const lastCheckTime = lastCheck ? new Date(lastCheck) : new Date(0);
    
    // Get user's reports from the last 24 hours
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    console.log(`Fetching notifications for: ${userName}, since: ${lastCheckTime}`);
    
    const { data: reports, error } = await supabase
      .from('reports')
      .select('id, reporter, status, assigned_responders, created_at, updated_at')
      .eq('reporter', userName)
      .gt('created_at', yesterday.toISOString())
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching notifications:', error);
      return { count: 0, reports: [], error: error.message };
    }
    
    // Filter for unread notifications (updated after last check)
    let unreadCount = 0;
    const unreadReports = [];
    
    reports?.forEach(report => {
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
    
    console.log(`Found ${unreadCount} unread notifications`);
    
    return { 
      count: unreadCount, 
      reports: unreadReports,
      total: reports?.length || 0
    };
  } catch (error) {
    console.error('Error getting unread notifications:', error);
    return { count: 0, reports: [], error: error.message };
  }
}

// Mark notifications as read for user
export function markNotificationsAsRead(userName) {
  try {
    if (!userName || userName.trim() === '') {
      return { success: false, error: "Invalid username" };
    }
    
    // Store current time as last check time
    localStorage.setItem(`lastNotificationCheck_${userName}`, new Date().toISOString());
    
    // Also clear the notification count in localStorage
    localStorage.setItem('notificationCount', '0');
    
    console.log(`Notifications marked as read for: ${userName}`);
    
    return { success: true, message: "Notifications marked as read" };
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    return { success: false, error: error.message };
  }
}

// Get recent reports for user
export async function getUserReports(userName, limit = 50) {
  try {
    if (!supabase) {
      throw new Error("Supabase not initialized");
    }
    
    if (!userName || userName.trim() === '') {
      return { data: [], error: "Invalid username" };
    }
    
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .ilike('reporter', `%${userName}%`)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('Error fetching user reports:', error);
    return { data: [], error: error.message };
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
    throw new Error("Failed to process image");
  }
}

// Get all reports (for admin dashboard)
export async function getAllReports(limit = 100) {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('Error fetching reports:', error);
    return { data: [], error: error.message };
  }
}

// Update report status
export async function updateReportStatus(reportId, newStatus, assignedResponders = null) {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    const validStatuses = ['pending', 'investigating', 'resolved', 'cancelled'];
    
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const updateData = { 
      status: newStatus,
      updated_at: new Date().toISOString() 
    };
    
    if (assignedResponders !== null) {
      updateData.assigned_responders = assignedResponders;
    }

    const { data, error } = await supabase
      .from('reports')
      .update(updateData)
      .eq('id', reportId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
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
    
    // Try to fetch schema or do a simple query
    const { data, error } = await supabase
      .from('reports')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      // Check if it's a missing table error
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return { 
          connected: true, 
          error: 'Table "reports" does not exist. Please create it first.',
          canCreateTables: true
        };
      }
      return { connected: false, error: error.message };
    }
    
    return { 
      connected: true, 
      data,
      message: "Successfully connected to Supabase"
    };
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
    
    return { counts, error: null };
  } catch (error) {
    console.error('Error getting report counts:', error);
    return { counts: null, error: error.message };
  }
}

// Search reports by reporter name or type
export async function searchReports(searchTerm, limit = 50) {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    if (!searchTerm || searchTerm.trim() === '') {
      return getAllReports(limit);
    }
    
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .or(`reporter.ilike.%${searchTerm}%,type.ilike.%${searchTerm}%,type_display.ilike.%${searchTerm}%`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('Error searching reports:', error);
    return { data: [], error: error.message };
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
    return { success: true, data };
  } catch (error) {
    console.error('Error deleting report:', error);
    throw error;
  }
}

// Get reports by status
export async function getReportsByStatus(status, limit = 50) {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('Error fetching reports by status:', error);
    return { data: [], error: error.message };
  }
}

// Get today's reports
export async function getTodaysReports() {
  try {
    if (!supabase) throw new Error("Supabase not initialized");
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('Error fetching today\'s reports:', error);
    return { data: [], error: error.message };
  }
}

// Export supabase instance for direct use if needed
export { supabase };