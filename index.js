"use strict";

// Fix the link to show confirmed cases if need be
window.showDeaths = getParameterByName("showType") === "Deaths";
if (showDeaths) {
  let seeByLink = $("#seeBy")[0];
  seeByLink.innerText = "See by confirmed cases";
  seeByLink.href = "./index.html?showType=Confirmed";
}
window.showCountry = getParameterByName("showCountry") || "US";


Papa.parse("https://query.data.world/s/ddilsdjgnj5zsvm3ouqgbcmm4ntkxv", {
  download: true,
  header: true,
  complete: function(results) {
    console.log("Received results:", results);
    let data = results.data;

    let series = findHighChartDataSeries(data);
    drawChart(series);
  }
});

function findHighChartDataSeries(resultData) {
  let dataRows = resultData.filter(row =>
    row.Country_Region === showCountry
    && (showDeaths ? row.Case_Type === "Deaths" : row.Case_Type === "Confirmed")
    // To help with debugging
    // && (["Ohio", "Texas", "New York"].includes(row.Province_State))
  );

  // Sort everything into a clear map
  let stateToDateToTotalMap = new Map();
  for (const row of dataRows) {
    if (!stateToDateToTotalMap.has(row.Province_State)) {
      stateToDateToTotalMap.set(row.Province_State, new Map());
    }
    let dateToTotalMap = stateToDateToTotalMap.get(row.Province_State);
    let momentDate = moment(row.Date, "MM/DD/YYYY");
    let dateInMS = momentDate.valueOf();
    if (!dateToTotalMap.has(dateInMS)) {
      dateToTotalMap.set(dateInMS, 0);
    }
    let total = dateToTotalMap.get(dateInMS);
    dateToTotalMap.set(dateInMS, total + (parseInt(row.Cases) || 0));
  }

  // Now put it into the format expected by HighCharts & pair down to the starting # of cases
  let series = [];
  const MIN_COUNT_TO_SHOW = showDeaths ? 10 : 100;
  for (const state of [...stateToDateToTotalMap.keys()].sort()) {
    let thisStateData = {name: state, data: []};
    let dateToTotalMap = stateToDateToTotalMap.get(state);
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

  return series;
}

function drawChart(series) {
  console.log("Drawing series:", series);

  window.chart = Highcharts.chart('container', {

    title: {
      text: "<div>COVID-19 data by state, </div><div>starting from " + (showDeaths ? "10 deaths" : "100 infections") + "</div>",
      useHTML: true,
    },

    subtitle: {
      text: "Source: <a href='https://data.world/covid-19-data-resource-hub/covid-19-case-counts/workspace/file?filename=COVID-19+Cases.csv'>John Hopkins via Data.World</a>",
      useHTML: true,
    },

    yAxis: {
      title: {
        text: showDeaths ? "Deaths" : "Confirmed Cases",
      },
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
}

window.onShowLogrithmic = function(event) {
  const showLogrithmic = event.checked;
  chart.yAxis[0].update({
    type: showLogrithmic ? "logarithmic" : "linear",
  });
};

window.hideAllStates = function(event) {
  let seriesArray = chart.series;
  console.log("There are " + seriesArray.length + " series.");
  $("#hideAllSpinner").removeClass("hide");
  setTimeout(() => {
    for (const series of seriesArray) {
      let message = "Hiding " + series.name + "...";
      console.log(message);
      if (series.visible) {
        series.hide();
      }
    }
    $("#hideAllSpinner").addClass("hide");
  }, 200)
};

function getParameterByName(name) {
  let match = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
  return match && decodeURIComponent(match[1].replace(/\+/g, " "));
}
