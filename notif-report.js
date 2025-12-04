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
      const fileName = `report-${Date.now()}.jpg`;
      
      // Convert base64 to blob
      const base64Response = await fetch(base64Image);
      const imageBlob = await base64Response.blob();
      
      console.log("Uploading to bucket: aid-upload");

      // Upload to storage bucket - CORRECT BUCKET NAME
      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from("aid-upload")  // CHANGED FROM "aid-upload-image" to "aid-upload"
        .upload(fileName, imageBlob, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error("Supabase Upload Error:", uploadError);
        
        // Provide helpful error messages
        if (uploadError.message && uploadError.message.includes('Bucket not found')) {
          throw new Error(`Bucket 'aid-upload' not found. Available buckets: aid-upload`);
        }
        
        if (uploadError.message && uploadError.message.includes('row-level security policy')) {
          throw new Error("Storage RLS policy blocking upload. Run: ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;");
        }
        
        throw uploadError;
      }

      console.log("Upload successful:", uploadData);

      // Get public URL
      const { data: publicUrlData } = supabase
        .storage
        .from("aid-upload")  // CHANGED HERE TOO
        .getPublicUrl(fileName);

      imageURL = publicUrlData.publicUrl;
      console.log("Image URL:", imageURL);
      
    } catch (imageError) {
      console.error("Image upload failed:", imageError);
      // Option 1: Throw error to stop process
      // throw imageError;
      
      // Option 2: Continue without image
      console.log("Continuing without image...");
    }
  }

  // 2. Insert report into database
  try {
    console.log("Inserting into database...");
    
    const reportData = {
      type: report.type || 'unknown',
      reporter: report.reporter || 'Anonymous',
      latitude: parseFloat(report.latitude),
      longitude: parseFloat(report.longitude || report.lng),
      photo_url: imageURL,
      created_at: new Date().toISOString()
    };
    
    console.log("Report data to insert:", reportData);

    const { data, error: insertError } = await supabase
      .from('reports')
      .insert([reportData])
      .select();

    if (insertError) {
      console.error("Supabase Insert Error:", insertError);
      
      if (insertError.code === 'PGRST204' || insertError.message.includes('Could not find')) {
        throw new Error(`Database error: ${insertError.message}. Run: DROP TABLE IF EXISTS public.reports CASCADE; then recreate table.`);
      }
      
      throw insertError;
    }

    console.log("Report saved successfully:", data);
    return { success: true, data };
    
  } catch (dbError) {
    console.error("Database operation failed:", dbError);
    throw dbError;
  }
}