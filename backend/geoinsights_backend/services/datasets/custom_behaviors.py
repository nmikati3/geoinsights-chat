from geoinsights_backend.services.retrieval import filter_data
from geoinsights_backend.services import initialize
import pandas as pd
from geoinsights_backend.services.world_map import show_flow_map_with_time_slider, show_bubble_chart_with_time_slider


def world_map(messages,response_type):

  if 'Geopolitics' in initialize.DATASETS.keys():
    specific_info_dict = initialize.DATASETS['Geopolitics']['specific_info_dict']
  else:
    raise ValueError(f"Geopolitics dataset not found")
  
  filtered_data = filter_data(initialize.DATASETS['Geopolitics']['DATA'],messages,specific_info_dict)

  filtered_data = filtered_data.explode('receiving_countries').explode('initiating_countries').groupby(
    [pd.Grouper(key='incident_start_date',freq='ME'),'initiating_countries','receiving_countries'],as_index=False
  ).agg({'incident_id':pd.Series.nunique})

  filtered_data = filtered_data[filtered_data['initiating_countries'] != filtered_data['receiving_countries']].reset_index(drop=True)

  filtered_data = filtered_data.rename(columns={'incident_id':'number_of_incidents'})

  if response_type == 'World Map (Flow Map)':
    fig = show_flow_map_with_time_slider(filtered_data)

  elif response_type == 'World Map (Bubble Chart)':
    filtered_data = filtered_data.groupby([
      'receiving_countries',
      'incident_start_date'
    ],as_index=False).agg({
      'number_of_incidents': 'sum'
    })
    fig = show_bubble_chart_with_time_slider(filtered_data)

  results = {
      'figures':[fig],
      'tables':[],
      'other_results':[]
  }

  return results