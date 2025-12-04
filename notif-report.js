// ============ SUPABASE CLIENT ==============
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const supabaseUrl = 'https://gwvepxupoxyyydnisulb.supabase.co'
const supabaseKey = 'sb_publishable_4baWNqraxymp0Gal3OKhxQ_Bl-IHHdt'
const supabase = createClient(supabaseUrl, supabaseKey)

// ======================================================
// ===== SAVE REPORT (SUPABASE UPLOAD + DATABASE) ======
// ======================================================
export async function saveReportToSupabase(report, base64Image) {
  console.log("Starting saveReportToSupabase with:", report);
  
  let imageURL = null;

  // 1. Upload image to storage if exists
  if (base64Image) {
    try {
      console.log("Processing image...");
      const fileName = `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
      
      // Convert base64 to blob
      const base64Response = await fetch(base64Image);
      const imageBlob = await base64Response.blob();
      
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
    const latitude = typeof report.latitude === 'number' ? report.latitude : parseFloat(report.latitude);
    const longitude = typeof report.longitude === 'number' ? report.longitude : parseFloat(report.longitude || report.lng);
    
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
      console.error("Error details:", insertError.details, insertError.hint);
      
      if (insertError.code === 'PGRST204' || insertError.message.includes('Could not find')) {
        throw new Error(`Database table 'reports' not found. Please create the table first.`);
      }
      
      if (insertError.message && insertError.message.includes('violates check constraint')) {
        throw new Error(`Invalid status value. Status must be one of: pending, investigating, resolved, cancelled`);
      }
      
      throw insertError;
    }

    console.log("Report saved successfully with status:", reportData.status);
    return { success: true, data };
    
  } catch (dbError) {
    console.error("Database operation failed:", dbError);
    throw dbError;
  }
}

// ======================================================
// ===== ADDITIONAL HELPER FUNCTIONS ======
// ======================================================

// Helper function to convert base64 to blob (alternative method)
export function base64ToBlob(base64) {
  try {
    const byteString = atob(base64.split(',')[1]);
    const mimeString = base64.split(',')[0].split(':')[1].split(';')[0];
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

// Update report status - FIXED: corrected 'invistigating' to 'investigating'
export async function updateReportStatus(reportId, newStatus) {
  try {
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

// Get reports by status
export async function getReportsByStatus(status) {
  try {
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

// Get report count by status - FIXED: corrected status names
export async function getReportCounts() {
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('status');

    if (error) throw error;
    
    const counts = {
      pending: 0,
      investigating: 0, // Changed from 'in_progress' to 'investigating'
      resolved: 0,
      cancelled: 0,
      total: data.length
    };
    
    data.forEach(report => {
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