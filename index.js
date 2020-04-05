"use strict";

window.isRunningLocally = window.location.href.includes("localhost:3000");
const covidDataURL = isRunningLocally ? "./covid-19-cases.csv" : "https://query.data.world/s/ddilsdjgnj5zsvm3ouqgbcmm4ntkxv";
const MAX_TOP_COUNTRIES = 20;
let loading = $("#loadingDiv").hide();
let dimWrapper = $("#dimWrapper").hide();
let loadingTimeout = null;


console.time("Fetching data");
showLoading(() => {
  Papa.parse(covidDataURL, {
    download: true,
    header: true,
    complete: function(results) {
      console.timeEnd("Fetching data");
      console.log("Received results:", results);
      window.resultData = results.data;

      showLoading(() => {
        window.dataAsOf = moment(resultData[0].Prep_Flow_Runtime, "MM/DD/YYYY h:mm:ss aa");
        trimResults();
        setupLocations();
        let series = filterIntoHighChartSeries();
        drawChart(series);
      });
    }
  });
}, true);

function trimResults() {
  console.time("Triming results");
  // To reduce memory consumption
  for (const row of resultData) {
    delete row.Difference;
    delete row.FIPS;
    delete row.Lat;
    delete row.Long;
    delete row.Prep_Flow_Runtime;
    delete row.Table_Names;
  }
  console.timeEnd("Triming results");
}

function setupLocations() {
  console.time("Setup Locations");
  let countries = new Set();
  window.countriesToProvinceStates = new Map();
  window.provinceStateToRegions = new Map();
  let countriesToCases = new Map();
  const yesterday = moment().subtract(1, 'days').format("M/D/YYYY");

  // Comb threw all of the results and find all of the locations
  for (const row of resultData) {
    let country = row.Country_Region;
    if (country) {
      let provinceState = row.Province_State;
      let region = row.Admin2;
      if (!countries.has(country)) {
        countries.add(country);
      }

      // Keep track of the top number from yesterday's total in each country
      if (row.Case_Type === "Confirmed" && row.Date === yesterday) {
        let cases = parseInt(row.Cases);
        if (!countriesToCases.get(country) || countriesToCases.get(country) < cases) {
          countriesToCases.set(country, cases);
        }
      }

      if (provinceState) {
        if (!countriesToProvinceStates.has(country)) {
          countriesToProvinceStates.set(country, new Set());
        }
        countriesToProvinceStates.get(country).add(provinceState);
      }

      if (region) {
        if (!provinceStateToRegions.has(provinceState)) {
          provinceStateToRegions.set(provinceState, new Set());
        }
        provinceStateToRegions.get(provinceState).add(region);
      }
    }
  }
  countries = Array.from(countries).sort();
  const topCountries = Array.from(countriesToCases.entries()).sort((entry1, entry2) => entry2[1] - entry1[1]).slice(0, MAX_TOP_COUNTRIES);
  window.topCountriesSet = new Set(topCountries.map(entry => entry[0]));

  // Make the HTML
  let topCountriesHTML = `<span class="countryTitle">Top ${MAX_TOP_COUNTRIES} Worst Countries:</span><br/>`;
  let allCountriesHTML = "<span class=\"countryTitle\">All Other Countries:</span><br/>";
  for (const country of countries) {
    const countryId = country.replace(/\W/g, '_');
    let isTopCountry = topCountriesSet.has(country);

    const countryHTML = `
<div class="option-country">
   <input type="checkbox" id="country_${countryId}" name="country" value="${country}"
          onclick="window.updateChart(this)" ${isTopCountry ? "checked" : ""}/>
   <label for="country_${countryId}">${country}</label><br/>
</div> `;
    if (isTopCountry) {
      topCountriesHTML += countryHTML;
    } else {
      allCountriesHTML += countryHTML;
    }
  }
  $("#allCountries").html(topCountriesHTML + allCountriesHTML);

  console.timeEnd("Setup Locations");
}

function filterIntoHighChartSeries() {
  console.time("Filter data");
  const byLocationType = getByLocationType();
  const byType = $("input[name='byCaseType']:checked").val(); // Confirmed or Deaths
  const MIN_COUNT_TO_SHOW = byType === "Deaths" ? 10 : 100;

  let filterFunction;
  let getLocationFunction;
  const countries = getSelectedCountries();
  switch (byLocationType) {
    case "country":
      filterFunction = row => {
        return (byType === row.Case_Type)
          && countries.has(row.Country_Region);
      };
      getLocationFunction = row => row.Country_Region;
      break;
    case "provinceState": {
      const provinceStates = getSelectedProvinceStates();
      filterFunction = row => {
        return (byType === row.Case_Type)
          && provinceStates.has(row.Province_State + "_" + row.Country_Region);
      };
      getLocationFunction = row => row.Province_State + " (" + row.Country_Region + ")";
    }
      break;
    case "region": {
      const regions = getSelectedRegions();
      filterFunction = row => {
        return (byType === row.Case_Type)
          && regions.has(row.Admin2 + "_" + row.Province_State + "_" + row.Country_Region);
      };
      getLocationFunction = row => row.Combined_Key;
    }
      break;
    default:
      throw new Error("Unknown location type:" + byLocationType);
  }

  // Sort everything into a clear map
  let locationToDateToTotalMap = new Map();
  let dateToDateInMSMap = new Map(); // moment is pretty slow when parsing the same date a million times
  for (const row of resultData) {
    if (filterFunction(row)) {

      const location = getLocationFunction(row);
      if (!locationToDateToTotalMap.has(location)) {
        locationToDateToTotalMap.set(location, new Map());
      }
      let dateToTotalMap = locationToDateToTotalMap.get(location);
      if (!dateToDateInMSMap.has(row.Date)) {
        let momentDate = moment(row.Date, "MM/DD/YYYY");
        let dateInMS = momentDate.valueOf();
        dateToDateInMSMap.set(row.Date, dateInMS);
      }
      let dateInMS = dateToDateInMSMap.get(row.Date);
      if (!dateToTotalMap.has(dateInMS)) {
        dateToTotalMap.set(dateInMS, 0);
      }
      let total = dateToTotalMap.get(dateInMS);
      dateToTotalMap.set(dateInMS, total + (parseInt(row.Cases) || 0));
    }
  }

  // Now put it into the format expected by HighCharts & pair down to the starting # of cases
  let series = [];
  for (const state of [...locationToDateToTotalMap.keys()].sort()) {
    let thisStateData = {name: state, data: []};
    let dateToTotalMap = locationToDateToTotalMap.get(state);
    let datesInSortedOrder = [...dateToTotalMap.keys()].sort();
    for (const dateInMS of datesInSortedOrder) {
      let totalOnDate = dateToTotalMap.get(dateInMS) || 0;
      if (totalOnDate >= MIN_COUNT_TO_SHOW) {
        thisStateData.data.push(totalOnDate);
      }
    }

    if (thisStateData.data.length > 0) {
      series.push(thisStateData);
    }
  }

  console.timeEnd("Filter data");
  return series;
}

function getByLocationType() {
  return $("input[name='byLocationType']:checked").val();
}

function getByLocationTypeDisplay() {
  switch (getByLocationType()) {
    case "country":
      return "Country";
    case "provinceState":
      return "Province/State";
    case "region":
      return "Region";
  }
}

function getSelectedCountries() {
  const countries = new Set();
  $.each($("input[name='country']:checked"), function() {
    countries.add($(this).val());
  });
  return countries;
}

function getSelectedProvinceStates() {
  const provinceStates = new Set();
  $.each($("input[name='provinceState']:checked"), function() {
    provinceStates.add($(this).val());
  });
  return provinceStates;
}

function getSelectedRegions() {
  const regions = new Set();
  $.each($("input[name='region']:checked"), function() {
    regions.add($(this).val());
  });
  return regions;
}

function drawChart(series) {
  console.time("Draw charts");
  const showDeaths = $("input[name='byCaseType']:checked").val() === "Deaths";
  const showLogrithmic = $("#showLogrithmicCheckbox")[0].checked;

  window.chart = Highcharts.chart('container', {

    title: {
      text: "<div>COVID-19 data by " + getByLocationTypeDisplay() + ", </div><div>starting from " + (showDeaths ? "10 deaths" : "100 infections") + "</div>",
      useHTML: true,
    },

    subtitle: {
      text: "Source: <a href='https://data.world/covid-19-data-resource-hub/covid-19-case-counts/workspace/file?filename=COVID-19+Cases.csv'>John Hopkins via Data.World</a>"
        + " as of " + window.dataAsOf.format("MMM D, YYYY [at] h:mm a"),
      useHTML: true,
    },

    yAxis: {
      title: {
        text: showDeaths ? "Deaths" : "Confirmed Cases",
      },
      type: showLogrithmic ? "logarithmic" : "linear",
      min: showDeaths ? 10 : 100,
    },

    xAxis: {
      // type: 'datetime',
      title: {
        text: "Days since hitting " + (showDeaths ? "10 deaths" : "100 confirmed cases"),
      },
    },

    tooltip: {
      headerFormat: '<b>{series.name}</b><br>',
      pointFormat: 'Confirmed: {point.y} cases'
    },

    legend: {
      layout: 'vertical',
      align: 'right',
      verticalAlign: 'middle'
    },

    plotOptions: {
      series: {
        marker: {
          enabled: true
        },
      },
    },

    series,

    responsive: {
      rules: [{
        condition: {
          maxWidth: 2000
        },
        chartOptions: {
          plotOptions: {
            series: {
              marker: {
                radius: 2.5
              },
            },
          },
        },
      }],
    },

  });
  console.timeEnd("Draw charts");
}

window.updateChart = function() {
  showLoading(() => {
    // Build the province & region selection options
    updateLocations();

    // Recreate the chart
    let series = filterIntoHighChartSeries();
    drawChart(series);
  });
};

window.handleProvinceStateSelected = function() {
  updateLocations();
  // If there are no selected provinces (ie. the first time they've clicked it) then select all.
  let selectedProvinceStates = getSelectedProvinceStates();
  if (selectedProvinceStates.size === 0) {
    handleSelectLocation("provinceState", "all");
  }
  updateChart();
};

window.handleRegionSelected = function() {
  updateLocations();
  // If there are no selected regions (ie. the first time they've clicked it) then select all.
  let selectedRegions = getSelectedRegions();
  if (selectedRegions.size === 0) {
    handleSelectLocation("region", "all");
  }
  updateChart();
};

window.updateLocations = function() {
  let selectedCountries = getSelectedCountries();
  let selectedProvinceStates = getSelectedProvinceStates();
  let selectedRegions = getSelectedRegions();
  const allProvinceStates = $("#allProvinceStates");
  const allRegions = $("#allRegions");
  switch (getByLocationType()) {
    case "country":
      allProvinceStates.addClass("disabled");
      allRegions.addClass("disabled");
      break;
    case "provinceState": {
      updateProvinces(selectedCountries, selectedProvinceStates, allProvinceStates);
      allProvinceStates.removeClass("disabled");
      allRegions.addClass("disabled");
      break;
    }
    case "region": {
      updateProvinces(selectedCountries, selectedProvinceStates, allProvinceStates);
      updateRegions(selectedCountries, selectedProvinceStates, selectedRegions, allRegions);
      allRegions.removeClass("disabled");
      allProvinceStates.removeClass("disabled");
    }
      break;
  }
};

function updateProvinces(selectedCountries, selectedProvinceStates, allProvinceStates) {
  let provinceStateHTML = "";
  for (const country of selectedCountries) {
    let provinceStates = window.countriesToProvinceStates.get(country);
    if (provinceStates) {
      const countryId = country.replace(/\W/g, '_');
      provinceStates = Array.from(provinceStates).sort();
      for (const provinceState of provinceStates) {
        const provinceStateId = provinceState.replace(/\W/g, '_');
        provinceStateHTML +=
          `
<input type="checkbox" id="province_${countryId}_${provinceStateId}" 
       name="provinceState" value="${provinceState}_${country}" ${selectedProvinceStates.has(provinceState + "_" + country) ? "checked" : ""}
       onclick="window.updateChart(this)"/>
<label for="province_${countryId}_${provinceStateId}">${provinceState} (${country})</label><br/>`;
      }
    }
  }
  allProvinceStates.html(provinceStateHTML);
}

function updateRegions(selectedCountries, selectedProvinceStates, selectedRegions, allRegions) {
  let regionHTML = "";
  for (const country of selectedCountries) {
    let provinceStates = window.countriesToProvinceStates.get(country);
    if (provinceStates) {
      const selectedProvinceStatesInThisCountry = Array.from(provinceStates).filter(
        provinceState => selectedProvinceStates.has(provinceState + "_" + country));

      for (const provinceState of selectedProvinceStatesInThisCountry) {
        let regions = window.provinceStateToRegions.get(provinceState);
        if (regions) {
          const countryId = country.replace(/\W/g, '_');
          const provinceStateId = provinceState.replace(/\W/g, '_');
          regions = Array.from(regions).sort();
          for (const region of regions) {
            const regionId = region.replace(/\W/g, '_');
            regionHTML +=
              `
<input type="checkbox" id="region_${countryId}_${provinceStateId}_${regionId}" 
       name="region" value="${region}_${provinceState}_${country}" ${selectedRegions.has(region + "_" + provinceState + "_" + country) ? "checked" : ""}
       onclick="window.updateChart(this)"/>
<label for="region_${countryId}_${provinceStateId}_${regionId}">${region}, ${provinceState}, ${country}</label><br/>`;
          }
        }
      }
    }
  }
  allRegions.html(regionHTML);
}

window.handleSelectLocation = function(locationType, allTopOrNone) {
  if (allTopOrNone === "all") {
    $.each($("input[name='" + locationType + "']"), function() {
      $(this).prop("checked", true);
    });
  } else if (allTopOrNone === "top") {
    $.each($("input[name='" + locationType + "']"), function() {
      $(this).prop("checked", topCountriesSet.has(this.value));
    });
  } else {
    $.each($("input[name='" + locationType + "']:checked"), function() {
      $(this).prop("checked", false);
    });
  }

  updateChart();
};

window.onShowLogarithmic = function(event) {
  const showLogrithmic = event.checked;
  chart.yAxis[0].update({
    type: showLogrithmic ? "logarithmic" : "linear",
  });
};

function getParameterByName(name) {
  let match = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
  return match && decodeURIComponent(match[1].replace(/\+/g, " "));
}

function showLoading(someFunc, expectAnotherLoad = false) {
  if (loadingTimeout) {
    window.clearTimeout(loadingTimeout);
    loadingTimeout = null;
  }

  dimWrapper.stop(true, true).animate({
    opacity: 0.8
  }, 500);
  dimWrapper.show();
  loading.show();

  loadingTimeout = setTimeout(() => {
    someFunc();
    if (!expectAnotherLoad) {
      loading.hide();
      dimWrapper.animate({
        opacity: 0.0
      }, 500);
      setTimeout(function() {
        dimWrapper.hide();
      }, 500);
    }
  }, 500)
}

