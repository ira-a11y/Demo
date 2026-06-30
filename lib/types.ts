export interface Demo {
  id: string;
  title: string;
  public_slug: string;
  created_at: string;
  updated_at: string;
}

export interface Screen {
  id: string;
  demo_id: string;
  name: string;
  image_path: string;
  width: number | null;
  height: number | null;
  order_index: number;
  created_at: string;
}

export interface Hotspot {
  id: string;
  screen_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: 'navigate' | 'tooltip' | 'layover';
  target_screen: string | null;
  tooltip_text: string | null;
  radius_tl: number;
  radius_tr: number;
  radius_br: number;
  radius_bl: number;
  layover_image_path: string | null;
  layover_full_screen: boolean;
  created_at: string;
}

export interface ApiError {
  error: { code: string; message: string };
}

// Viewer bundle types
export interface ViewerHotspot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: 'navigate' | 'tooltip' | 'layover';
  targetScreen: string | null;
  tooltipText: string | null;
  radiusTl: number;
  radiusTr: number;
  radiusBr: number;
  radiusBl: number;
  layoverImageUrl: string | null;
  layoverFullScreen: boolean;
}

export interface ViewerScreen {
  id: string;
  name: string;
  imageUrl: string;
  orderIndex: number;
  width: number | null;
  height: number | null;
  hotspots: ViewerHotspot[];
}

export interface ViewerBundle {
  demo: { title: string; slug: string };
  screens: ViewerScreen[];
}
