from geoinsights_backend.services.hardcoded_values import get_countries, get_sectors

geopolitics_specific_info_dict = {
  "topic": "geopolitical incidents",
  "example": """
For example, for the question: "Tell me about Russian cyberattacks. Tell me also about sanctions between March 12 2021 and May 05 2021.":

This is what the output would look like:
[
  [
    ["initiating_countries","Russia"],
    ["incident_type","cyber"],
  ],
  [
    ["incident_type","sanctions"],
    ["incident_start_date",">= 2021-03-12"],
    ["incident_start_date","<= 2021-05-01"],
  ],
]

This output will be used to filter the dataset as follows:
data[
  ((data["initiating_countries"].apply(lambda x: "Russia" in x)) & (data["incident_type"] == "cyber")) |
  ((data["incident_type"] == "sanctions") & (data["incident_start_date"] >= pd.to_datetime("2021-03-12")) & (data["incident_start_date"] <= pd.to_datetime("2021-05-01")))
]
""",
  "dataset_context_filtering": f"""
The dataset contains geopolitical incidents and the following columns:
  - initiating_countries: the list of countries that initiated the incident (countries behind the cyberattack, countries providing military aid, countries imposing sanctions, countries attacking other countries, countries participating in an international summit) which elements must be among the countries specified below
  - benefiting_countries: the list of countries benefiting from the incident (this is only non-null for military aid incidents and represents the countries to which the military aid is provided) which elements must be among the countries specified below
  - receiving_countries: the list of countries receiving the incident (countries targeted by the cyberattack, countries on which sanctions are imposed, countries attacked by other countries) which elements must be among the countries specified below
  - receiving_economic_sectors: ist of economic sectors targeted by the incident (this is only non-null for cyber incidents) which elements must be among the economic sectors specified below
  - incident_type: the type of geopolitical incident, takes one of the following values: 'cyber', 'sanctions', 'military-aid', 'military-offensive', 'summits'
  - incident_start_date (the start date of the incident)

The countries should take values among the following:
{get_countries()}

The receiving_economic_sectors should take values among the following:
{get_sectors()}  
""",
  "column_names": """
  - initiating_countries
  - benefiting_countries
  - receiving_countries
  - receiving_economic_sectors
  - incident_type
  - incident_start_date  
""",
  "role": "geopolitical analyst",
  "instructions":"Make sure to reference the URL links in your response to verify the results.",
  "context":"""
────────────────────────────────────────
INCIDENT SUMMARIES CONTEXT  
────────────────────────────────────────

Here are summaries of incidents to use to answer the question:  
""",
  "dataset_context_quantitative": f"""
The dataset you have access to, to answer the question is a dataset of geopolitical incidents (cyberattacks, military aid, sanctions, military offensives, international summits), each incident is identified by a unique incident_id. It contains the following variables:
  - incident_id: string // unique id of the incident, each incident_id represents a unique geopolitical incident.
  - incident_start_date: datetime // the start date of the incident
  - number_of_reports: integer // the number of articles mentioning the incident
  - url_list: list // the list of the URLs to the articles that mention the incident
  - source_url_list: dict // the set of sources for the articles that mention the incident
  - initiating_countries: string[] // the list of countries that initiated the incident (countries behind the cyberattack, countries providing military aid, countries imposing sanctions, countries attacking other countries)
  - benefiting_countries: string[] // the list of countries benefiting from the incident (this is only non-null for military aid incidents and represents the countries to which the military aid is provided)
  - receiving_countries: string[] // the list of countries receiving the incident (countries targeted by the cyberattack, countries on which sanctions are imposed, countries attacked by other countries)
  - receiving_economic_sectors: string[] // list of economic sectors targeted by the incident (this is only non-null for cyber incidents)
  - initiators: string[] // list of actors behind the incident (threat actor in case of a cyberattack, countries in case of military aid, sanctions, military offensives)
  - beneficiaries: string[] // list of actors benefiting from the incident (this is only non-null for military aid incidents and represents the countries that received the military aid)
  - receivers: string[] // list of actors receiving the incident (target in case of a cyberattack, countries in case of military aid, sanctions and, military offensives)
  - incident_sub_types: string[] // list of sub-incident types (this is only non-null for cyber incidents and international summits incidetns and represents the type of cyber incident or the summit name). For cyber incidents, the values are among: Data Theft, Disruption, Ransomware, Hijacking, Data Theft and Doxing. For international summits, they're the summit name: NATO, G7, European Union, BRICS, World Economic Forum, etc...
  - incident_type: string // the type of geopolitical incident: 'cyber' means the incident is a cyberattack, 'military-aid' means the incident is the announcement that countries are providing military aid to other countries, 'sanctions' means that countries are imposing sanctions on other countries, 'military-offensive' means that countries are attacking other countries, 'summits' means that countries are meeting to discuss global affairs
  - incident_summary: string // summary of the incident. This can be useful to look for information that may not be available through the other columns using pd.Series.str.contains logic

The countries should take values among the following:
{get_countries()}

The receiving_economic_sectors should take values among the following:
{get_sectors()}
""",
  "date_column": "incident_start_date",
  "columns_as_list": ["initiating_countries", "benefiting_countries", "receiving_countries"],
  "id": "incident_id",
  "text_column": "incident_summary",
  "columns_to_keep_in_rerank": ["incident_start_date","incident_summary","url_list"],
  "deep_research_retrieve_tool_description":"For searching through a dataset of geopolitical events that contains 5 types of geopolitical events: cyberattacks, international summits, military aid announcements, sanction announcements, military offensives. Note that the dataset returned will contain only 3 columns: 'incident_start_date','incident_summary','url_list'.",
  "deep_research_compute_statistics_tool_description":"For computing statistics on the dataset of geopolitical events, e.g.: computing the average number of incidents for a country, the average number of incidents for a given type, the average number of incidents for a given year, etc...",
  "deep_research_sources_guideline":"""
3. In your report, you should return inline citations for each source that the researcher found. In particular, the researcher will use the retrieve tool to find URLs of articles that mention the incidents, make sure to include them in your response.  
""",
  "deep_research_citation_rules":"""
<Citation Rules>
- Assign each unique URL a single citation number in your text
- End with ### Sources that lists each source with corresponding numbers
- IMPORTANT: Number sources sequentially without gaps (1,2,3,4...) in the final list regardless of which sources you choose
- Example format:
  [1] Source Title: URL
  [2] Source Title: URL
</Citation Rules>
""",
  "deep_research_relevant_sources_format":"[Title](URL) format",
  "deep_research_sources_type":"The sources should be the URLs of the articles that mention the incidents."
}


cyberattacks_specific_info_dict = {
  "topic": "cyberattacks",
  "example": """
For example, for the question: "Tell me about Russian, data theft cyberattacks. Tell me also about ransomware cyberattacks between March 12 2021 and May 05 2021.":

This is what the output would look like:
[
  [
    ["cleaned_attacking_countries","Russia"],
    ["cleaned_cyber_incident_type","Data Theft"],
  ],
  [
    ["cleaned_cyber_incident_type","Ransomware"],
    ["incident_start_date",">= 2021-03-12"],
    ["incident_start_date","<= 2021-05-01"],
  ],
]

This output will be used to filter the dataset as follows:
data[
  ((data["cleaned_attacking_countries"].apply(lambda x: "Russia" in x)) & (data["cleaned_cyber_incident_type"] == "Data Theft")) |
  ((data["cleaned_cyber_incident_type"] == "Ransomware") & (data["incident_start_date"] >= pd.to_datetime("2021-03-12")) & (data["incident_start_date"] <= pd.to_datetime("2021-05-01")))
]
""",
  "dataset_context_filtering": f"""
The dataset contains cyberattacks and the following columns:
  - cleaned_attacking_countries: the list of countries that initiated the incident (countries behind the cyberattack, countries providing military aid, countries imposing sanctions, countries attacking other countries, countries participating in an international summit) which elements must be among the countries specified below
  - cleaned_targeted_countries: the list of countries receiving the incident (countries targeted by the cyberattack, countries on which sanctions are imposed, countries attacked by other countries) which elements must be among the countries specified below
  - cleaned_targeted_economic_sectors: ist of economic sectors targeted by the incident (this is only non-null for cyber incidents) which elements must be among the economic sectors specified below
  - cleaned_cyber_incident_type: the type of cyber incident, takes one of the following values: 'Data Theft', 'Disruption', 'Ransomware', 'Hijacking', 'Data Theft and Doxing'
  - incident_start_date (the start date of the incident)

The countries should take values among the following:
{get_countries()}

The receiving_economic_sectors should take values among the following:
{get_sectors()}  
""",
  "column_names": """
  - cleaned_attacking_countries
  - cleaned_targeted_countries
  - cleaned_targeted_economic_sectors
  - cleaned_cyber_incident_type
  - incident_start_date  
""",
  "role": "cybersecurity analyst",
  "instructions":"Make sure to reference the URL links in your response to verify the results.",
  "context":"""
────────────────────────────────────────
INCIDENT SUMMARIES CONTEXT  
────────────────────────────────────────

Here are summaries of incidents to use to answer the question:  
""",
  "dataset_context_quantitative": f"""
The dataset you have access to, to answer the question is a dataset of cyberattacks, each incident is identified by a unique incident_id. It contains the following variables:
  - incident_id: string // unique id of the incident, each incident_id represents a unique geopolitical incident.
  - incident_start_date: datetime // the start date of the incident
  - url: list // the list of the URLs to the articles that mention the incident
  - cleaned_attacking_countries: string[] // the list of countries that initiated the incident (countries behind the cyberattack, countries providing military aid, countries imposing sanctions, countries attacking other countries, countries participating in an international summit)
  - cleaned_targeted_countries: string[] // the list of countries receiving the incident (countries targeted by the cyberattack, countries on which sanctions are imposed, countries attacked by other countries)
  - cleaned_targeted_economic_sectors: string[] // list of economic sectors targeted by the incident (this is only non-null for cyber incidents)
  - cleaned_cyber_incident_type: string // the type of cyber incident, takes one of the following values: 'Data Theft', 'Disruption', 'Ransomware', 'Hijacking', 'Data Theft and Doxing'
  - incident_summary: string // summary of the incident. This can be useful to look for information that may not be available through the other columns using pd.Series.str.contains logic

The countries should take values among the following:
{get_countries()}

The receiving_economic_sectors should take values among the following:
{get_sectors()}
""",
  "date_column": "incident_start_date",
  "columns_as_list": ["cleaned_attacking_countries", "cleaned_targeted_countries", "cleaned_targeted_economic_sectors"],
  "id": "incident_id",
  "text_column": "incident_summary",
  "columns_to_keep_in_rerank": ["incident_start_date","incident_summary","url"],
  "deep_research_retrieve_tool_description":"For searching through a dataset of cyberattacks. Note that the dataset returned will contain only 3 columns: 'incident_start_date','incident_summary','url'.",
  "deep_research_compute_statistics_tool_description":"For computing statistics on the dataset of cyberattacks, e.g.: computing the average number of incidents for a country, the average number of incidents for a given type, the average number of incidents for a given year, etc...",
  "deep_research_sources_guideline":"""
3. In your report, you should return inline citations for each source that the researcher found. In particular, the researcher will use the retrieve tool to find URLs of articles that mention the incidents, make sure to include them in your response.  
""",
  "deep_research_citation_rules":"""
<Citation Rules>
- Assign each unique URL a single citation number in your text
- End with ### Sources that lists each source with corresponding numbers
- IMPORTANT: Number sources sequentially without gaps (1,2,3,4...) in the final list regardless of which sources you choose
- Example format:
  [1] Source Title: URL
  [2] Source Title: URL
</Citation Rules>
""",
  "deep_research_relevant_sources_format":"[Title](URL) format",
  "deep_research_sources_type":"The sources should be the URLs of the articles that mention the incidents."
}


amazon_specific_info_dict = {
  "topic": "amazon reviews",
  "example": """
For example, for the question: "Tell me about descriptive & contextual joyful reviews. Tell me also about reviews on Hobbies, Lifestyle & Equipment products between March 12 2021 and May 05 2021.":

This is what the output would look like:
[
  [
    ["review_quality","Descriptive & Contextual"],
    ["emotion_type","Joy"],
  ],
  [
    ["product_type","Hobbies, Lifestyle & Equipment"],
    ["review_date",">= 2021-03-12"],
    ["review_date","<= 2021-05-01"],
  ],
]

This output will be used to filter the dataset as follows:
data[
  ((data["review_quality"] == "Descriptive & Contextual") & (data["emotion_type"] == "Joy")) |
  ((data["product_type"] == "Hobbies, Lifestyle & Equipment") & (data["review_date"] >= pd.to_datetime("2021-03-12")) & (data["review_date"] <= pd.to_datetime("2021-05-01")))
]
""",
  "dataset_context_filtering": f"""
The dataset contains Amazon product reviews and the following columns:
  - star_rating: the star rating of the review (integer), takes one of the following values: 1, 2, 3, 4, 5
  - verified_purchase: whether the review is verified purchase, either 'Y' or 'N'
  - aspect: the aspect of the product that the review is about, takes one of the following values: 'Quality & Performance', 'Usability & Experience', 'Value for Money', 'Delivery & Packaging', 'Brand & Trust'
  - sentiment: the sentiment of the review, takes one of the following values: 'positive', 'negative', 'neutral'
  - review_quality: the quality of the review, takes one of the following values: 'Basic Opinion', 'Descriptive & Contextual', 'Analytical & Comparative', 'Low-Information', 'Expert-Level / Long-Term Insight'
  - emotion_type: the emotion of the review, takes one of the following values: 'Joy', 'Frustration', 'Disappointment', 'Neutral', 'Trust', 'Anger', 'Surprise', 'Fear'
  - price_sensitivity: the price sensitivity of the review, takes one of the following values: 'No comment on price', 'Good value', 'Overpriced'
  - product_type: the type of product, takes one of the following values: 'Hobbies, Lifestyle & Equipment', 'Electronics & Technology', 'Home, Kitchen & Furniture', 'Apparel, Beauty & Personal Care', 'Consumables'
  - review_date: the date of the review
""",
  "column_names": """
  - star_rating
  - verified_purchase
  - aspect
  - sentiment
  - review_quality
  - emotion_type
  - price_sensitivity
  - product_type
  - review_date  
""",
  "role": "e-commerce analyst",
  "instructions":"Make sure to reference the review_id in your response to verify the results.",
  "context":"""
────────────────────────────────────────
REVIEWS CONTEXT  
────────────────────────────────────────

Here are reviews to use to answer the question:  
""",
  "dataset_context_quantitative": f"""
The dataset you have access to, to answer the question is a dataset of Amazon product reviews, each review is identified by a unique review_id. It contains the following variables:
  - review_id: string // unique id of the review, each review_id represents a unique Amazon product review.
  - customer_id: string // the id of the customer who wrote the review
  - product_id: string // the id of the product that the review is about
  - product_title: string // the title of the product that the review is about
  - review_headline: string // the headline of the review
  - review_body: string // the body of the review
  - star_rating: integer // the star rating of the review (integer), takes one of the following values: 1, 2, 3, 4, 5
  - verified_purchase: whether the review is verified purchase, either 'Y' or 'N'
  - aspect: the aspect of the product that the review is about, takes one of the following values: 'Quality & Performance', 'Usability & Experience', 'Value for Money', 'Delivery & Packaging', 'Brand & Trust'
  - sentiment: the sentiment of the review, takes one of the following values: 'positive', 'negative', 'neutral'
  - review_quality: the quality of the review, takes one of the following values: 'Basic Opinion', 'Descriptive & Contextual', 'Analytical & Comparative', 'Low-Information', 'Expert-Level / Long-Term Insight'
  - emotion_type: the emotion of the review, takes one of the following values: 'Joy', 'Frustration', 'Disappointment', 'Neutral', 'Trust', 'Anger', 'Surprise', 'Fear'
  - price_sensitivity: the price sensitivity of the review, takes one of the following values: 'No comment on price', 'Good value', 'Overpriced'
  - product_type: the type of product, takes one of the following values: 'Hobbies, Lifestyle & Equipment', 'Electronics & Technology', 'Home, Kitchen & Furniture', 'Apparel, Beauty & Personal Care', 'Consumables'
  - review_date: the date of the review
""",
  "date_column": "review_date",
  "columns_as_list": [],
  "id": "review_id",
  "text_column": "review_body",
  "columns_to_keep_in_rerank": ["review_id","review_date","review_body"],
  "deep_research_retrieve_tool_description":"For searching through a dataset of Amazon product reviews. Note that the dataset returned will contain only 3 columns: 'review_id','review_date','review_body'.",
  "deep_research_compute_statistics_tool_description":"For computing statistics on the dataset of Amazon product reviews, e.g.: computing the average number of reviews for a product, the average number of reviews for a given type, the average number of reviews for a given year, etc...",
  "deep_research_sources_guideline":"""
3. In your report, you should return inline citations for each source that the researcher found. In particular, the researcher will use the retrieve tool to find ids of reviews, make sure to include them in your response.  
""",
  "deep_research_citation_rules":"""
<Citation Rules>
- Assign each unique review_id a single citation number in your text
- End with ### Sources that lists each source with corresponding numbers
- IMPORTANT: Number sources sequentially without gaps (1,2,3,4...) in the final list regardless of which sources you choose
- Example format:
  [1] review_id
  [2] review_id
</Citation Rules>
""",
  "deep_research_relevant_sources_format":"[Title](review_id) format",
  "deep_research_sources_type":"The sources should be the review ids of the reviews that mention the products."
}