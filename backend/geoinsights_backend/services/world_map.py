import pandas as pd
import numpy as np
from geoinsights_backend.services.hardcoded_values import get_country_coords, get_block_map
import json
from plotly.utils import PlotlyJSONEncoder


# --- Assign colors based on flow type ---
def get_color(source, target):
    if 'Global South' in (source, target):
        return 'orange'
    elif source == 'West' and target == 'China-aligned':
        return 'blue'
    elif source == 'China-aligned' and target == 'West':
        return 'red'
    elif target is None and source == 'West':
        return 'blue'
    elif target is None and source == 'China-aligned':
        return 'red'
    elif target is None and source == 'Global South':
        return 'orange'
    else:
        return 'gray'
    

# --- Bézier curve path generation ---
def curved_path(lat1, lon1, lat2, lon2, curvature=0.2, n_points=30):
    # midpoint
    mid_lat = (lat1 + lat2) / 2
    mid_lon = (lon1 + lon2) / 2

    # direction angle
    angle = np.arctan2(lat2 - lat1, lon2 - lon1)

    # control point offset
    dx = curvature * np.cos(angle + np.pi / 2)
    dy = curvature * np.sin(angle + np.pi / 2)

    ctrl_lat = mid_lat + dy
    ctrl_lon = mid_lon + dx

    lats = []
    lons = []
    for t in np.linspace(0, 1, n_points):
        x = (1 - t)**2 * lon1 + 2 * (1 - t) * t * ctrl_lon + t**2 * lon2
        y = (1 - t)**2 * lat1 + 2 * (1 - t) * t * ctrl_lat + t**2 * lat2
        lons.append(x)
        lats.append(y)
    return lats, lons



def show_flow_map_with_time_slider(df):

    country_coords = get_country_coords()
    block_map = get_block_map()

    initiating_countries = df['initiating_countries'].unique()
    receiving_countries = df['receiving_countries'].unique()

    country_coords = {k: country_coords[k] for k in list(set(initiating_countries) | set(receiving_countries)) if k in country_coords}
    block_map = {k: block_map[k] for k in list(set(initiating_countries) | set(receiving_countries)) if k in block_map}

    block_colors = {
        'West': 'blue',
        'China-aligned': 'red',
        'Global South': 'orange',
    }
    # Get coordinates
    def get_coords(country):
        return pd.Series(country_coords.get(country, (None, None)), index=['lat', 'lon'])

    df[['start_lat', 'start_lon']] = df['initiating_countries'].apply(get_coords)
    df[['end_lat', 'end_lon']] = df['receiving_countries'].apply(get_coords)
    df['source_block'] = df['initiating_countries'].map(block_map)
    df['target_block'] = df['receiving_countries'].map(block_map)

    df['color'] = df.apply(lambda row: get_color(row['source_block'], row['target_block']), axis=1)

    # Build fig_dict
    fig_dict = {
        "data": [],
        "layout": {},
        "frames": []
    }

    # Layout
    fig_dict["layout"]["title"] = "Geopolitical Arrows Over Time"

    fig_dict["layout"]["geo"] = dict(
        scope="world",
        showland=True,
        landcolor='rgb(243, 243, 243)',
        countrycolor='rgb(204, 204, 204)',
        showcoastlines=True,
        projection=dict(type='natural earth'),
        resolution=50,
        showcountries=True
    )

    # Initial data
    initial_date = df['incident_start_date'].min()
    df_initial = df[df['incident_start_date'] == initial_date]
    df = df.sort_values('incident_start_date').reset_index(drop=True)

    for _, row in df_initial.iterrows():
        lats, lons = curved_path(row['start_lat'], row['start_lon'], row['end_lat'], row['end_lon'], curvature=20)
        fig_dict["data"].append(dict(
            type="scattergeo",
            lat=lats,
            lon=lons,
            mode="lines",
            line=dict(width=min(max(row['number_of_incidents'],1.5),30), color=row['color']),
            text=f"{row['initiating_countries']} → {row['receiving_countries']}" + f": ({row['number_of_incidents']})",
            #name=f"{row['initiating_countries']} → {row['receiving_countries']}".ljust(longest_text_length),
            hoverinfo="text",
            showlegend=False
        ))

        fig_dict["data"].append(dict(
            type="scattergeo",
            lon=[row['start_lon']],
            lat=[row['start_lat']],
            mode='markers',
            marker=dict(size=10, color=block_colors[block_map[row['initiating_countries']]], opacity=0.9),
            name=row['initiating_countries'],
            showlegend=False
        ))

        fig_dict["data"].append(dict(
            type="scattergeo",
            lon=[row['end_lon']],
            lat=[row['end_lat']],
            mode='markers',
            marker=dict(size=10, color=block_colors[block_map[row['receiving_countries']]], opacity=0.9),
            name=row['receiving_countries'],
            showlegend=False
        ))

    # Slider definition
    sliders_dict = {
        "active": 0,
        "yanchor": "top",
        "xanchor": "left",
        "currentvalue": {
            "font": {"size": 20},
            "prefix": "Year:",
            "visible": True,
            "xanchor": "right"
        },
        "transition": {"duration": 300, "easing": "cubic-in-out"},
        "pad": {"b": 10, "t": 50},
        "len": 0.9,
        "x": 0.1,
        "y": 0,
        "steps": []
    }

    # Create frames
    for date in sorted(df['incident_start_date'].unique()):
        frame_name = str(date)[:10]
        frame = {"data": [], "name": frame_name}
        df_date = df[df['incident_start_date'] == date]

        for _, row in df_date.iterrows():
            lats, lons = curved_path(row['start_lat'], row['start_lon'], row['end_lat'], row['end_lon'], curvature=20)
            frame["data"].append(dict(
                type="scattergeo",
                lat=lats,
                lon=lons,
                mode="lines",
                line=dict(width=min(max(row['number_of_incidents'],1.5),30), color=row['color']),
                text=f"{row['initiating_countries']} → {row['receiving_countries']}" + f": ({row['number_of_incidents']})",
                #name=f"{row['initiating_countries']} → {row['receiving_countries']}".ljust(longest_text_length),
                hoverinfo="text",
                showlegend=False
            ))

            frame["data"].append(dict(
                type="scattergeo",
                lon=[row['start_lon']],
                lat=[row['start_lat']],
                mode='markers',
                marker=dict(size=10, color=block_colors[block_map[row['initiating_countries']]], opacity=0.9),
                name=row['initiating_countries'],
                showlegend=False
            ))

            frame["data"].append(dict(
                type="scattergeo",
                lon=[row['end_lon']],
                lat=[row['end_lat']],
                mode='markers',
                marker=dict(size=10, color=block_colors[block_map[row['receiving_countries']]], opacity=0.9),
                name=row['receiving_countries'],
                showlegend=False
            ))


        fig_dict["frames"].append(frame)

        sliders_dict["steps"].append({
            "args": [[frame_name], {"frame": {"duration": 300, "redraw": True}, "mode": "immediate"}],
            "label": frame_name,
            "method": "animate"
        })

    fig_dict["layout"]["autosize"] = True
    fig_dict["layout"]["margin"] = dict(l=0, r=0, t=30, b=0)
    fig_dict["layout"]["sliders"] = [sliders_dict]
    fig_dict["layout"]["updatemenus"] = [
        {
            "type": "buttons",
            "showactive": False,
            "x": 0.05,
            "y": 0,
            "xanchor": "right",
            "yanchor": "top",
            "direction": "left",
            "pad": {"r": 10, "t": 70},
            "buttons": [
                {
                    "label": "Play",
                    "method": "animate",
                    "args": [None, {"frame": {"duration": 500, "redraw": True}, "fromcurrent": True, "mode": "immediate"}]
                },
                {
                    "label": "Pause",
                    "method": "animate",
                    "args": [[None], {"frame": {"duration": 0, "redraw": False}, "mode": "immediate"}]
                }
            ]
        }
    ]

    fig_json = json.dumps(fig_dict, cls=PlotlyJSONEncoder)

    return fig_json


def show_bubble_chart_with_time_slider(df):

    df = df.sort_values('incident_start_date').reset_index(drop=True)

    country_coords = get_country_coords()
    block_map = get_block_map()

    receiving_countries = df['receiving_countries'].unique()

    country_coords = {k: country_coords[k] for k in receiving_countries if k in country_coords}
    block_map = {k: block_map[k] for k in receiving_countries if k in block_map}

    # Get coordinates
    def get_coords(country):
        return pd.Series(country_coords.get(country, (None, None)), index=['lat', 'lon'])

    df[['lat', 'lon']] = df['receiving_countries'].apply(get_coords)
    df['block'] = df['receiving_countries'].map(block_map)

    df['color'] = df.apply(lambda row: get_color(row['block'], None), axis=1)

    # Build fig_dict
    fig_dict = {
        "data": [],
        "layout": {},
        "frames": []
    }

    # Layout
    fig_dict["layout"]["title"] = "Geopolitical Incidents Over Time"

    fig_dict["layout"]["geo"] = dict(
        scope="world",
        showland=True,
        landcolor='rgb(243, 243, 243)',
        countrycolor='rgb(204, 204, 204)',
        showcoastlines=True,
        projection=dict(type='natural earth'),
        resolution=50,
        showcountries=True
    )

    # Initial data
    initial_date = df['incident_start_date'].min()
    df_initial = df[df['incident_start_date'] == initial_date]
    df = df.sort_values('incident_start_date').reset_index(drop=True)

    for _, row in df_initial.iterrows():
        fig_dict["data"].append(dict(
            type="scattergeo",
            lat=[row['lat']],
            lon=[row['lon']],
            mode="markers",
            marker=dict(size=min(row['number_of_incidents'],30), color=row['color']),
            text=row['receiving_countries'] + f": ({row['number_of_incidents']})",
            hoverinfo="text",
            showlegend=False
        ))

    # Slider definition
    sliders_dict = {
        "active": 0,
        "yanchor": "top",
        "xanchor": "left",
        "currentvalue": {
            "font": {"size": 20},
            "prefix": "Year:",
            "visible": True,
            "xanchor": "right"
        },
        "transition": {"duration": 300, "easing": "cubic-in-out"},
        "pad": {"b": 10, "t": 50},
        "len": 0.9,
        "x": 0.1,
        "y": 0,
        "steps": []
    }

    # Create frames
    for date in sorted(df['incident_start_date'].unique()):
        frame_name = str(date)[:10]
        frame = {"data": [], "name": frame_name}
        df_date = df[df['incident_start_date'] == date]

        for _, row in df_date.iterrows():
            frame["data"].append(dict(
                type="scattergeo",
                lat=[row['lat']],
                lon=[row['lon']],
                mode="markers",
                marker=dict(size=min(row['number_of_incidents'],30), color=row['color']),
                text=row['receiving_countries'] + f": ({row['number_of_incidents']})",
                hoverinfo="text",
                showlegend=False
            ))

        fig_dict["frames"].append(frame)

        sliders_dict["steps"].append({
            "args": [[frame_name], {"frame": {"duration": 300, "redraw": True}, "mode": "immediate"}],
            "label": frame_name,
            "method": "animate"
        })

    fig_dict["layout"]["autosize"] = True
    fig_dict["layout"]["margin"] = dict(l=0, r=0, t=30, b=0)
    fig_dict["layout"]["sliders"] = [sliders_dict]
    fig_dict["layout"]["updatemenus"] = [
        {
            "type": "buttons",
            "showactive": False,
            "x": 0.05,
            "y": 0,
            "xanchor": "right",
            "yanchor": "top",
            "direction": "left",
            "pad": {"r": 10, "t": 70},
            "buttons": [
                {
                    "label": "Play",
                    "method": "animate",
                    "args": [None, {"frame": {"duration": 500, "redraw": True}, "fromcurrent": True, "mode": "immediate"}]
                },
                {
                    "label": "Pause",
                    "method": "animate",
                    "args": [[None], {"frame": {"duration": 0, "redraw": False}, "mode": "immediate"}]
                }
            ]
        }
    ]

    fig_json = json.dumps(fig_dict, cls=PlotlyJSONEncoder)

    return fig_json