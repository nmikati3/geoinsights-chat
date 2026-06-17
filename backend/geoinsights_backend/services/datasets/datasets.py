from geoinsights_backend.services.datasets.utils import (
    load_cyberattacks_data,
    create_cyberattacks_sandbox,
    load_geopolitics_data,
    create_geopolitics_sandbox,
    load_amazon_data,
    create_amazon_sandbox,
)
from geoinsights_backend.services.datasets.prompt_info import (
    cyberattacks_specific_info_dict,
    geopolitics_specific_info_dict,
    amazon_specific_info_dict,
)


global DATASETS

DATASETS = {
    #'Cyberattacks':{
    #    'load_data': load_cyberattacks_data,
    #    'create_sandbox': create_cyberattacks_sandbox,
    #    'specific_info_dict': cyberattacks_specific_info_dict,
    #    'DATA': None,
    #    'SANDBOX': None,
    #},
    'Press Articles':{
        'load_data': load_geopolitics_data,
        'create_sandbox': create_geopolitics_sandbox,
        'specific_info_dict': geopolitics_specific_info_dict,
        'DATA': None,
        'SANDBOX': None,
    },
    'Amazon Reviews':{
        'load_data': load_amazon_data,
        'create_sandbox': create_amazon_sandbox,
        'specific_info_dict': amazon_specific_info_dict,
        'DATA': None,
        'SANDBOX': None,
    },
}